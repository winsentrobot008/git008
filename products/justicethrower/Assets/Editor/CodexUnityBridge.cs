#if UNITY_EDITOR
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace JusticeThrower.Editor
{
    /// <summary>
    /// Loopback control surface for the Codex agent.
    /// Binds 127.0.0.1 only. Every Unity API call is marshalled onto the main
    /// thread through the EditorApplication.update pump.
    /// </summary>
    [InitializeOnLoad]
    public static class CodexUnityBridge
    {
        public const string Host = "127.0.0.1";
        public const int DefaultPort = 8765;
        const string PortKey = "JusticeThrower.CodexBridge.Port";
        const string EnabledKey = "JusticeThrower.CodexBridge.Enabled";
        const int RequestTimeoutMs = 30000;

        sealed class WorkItem
        {
            public JObject Request;
            public JObject Response;
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
        }

        static readonly ConcurrentQueue<WorkItem> Pending = new ConcurrentQueue<WorkItem>();
        static HttpListener _listener;
        static Thread _thread;
        static volatile bool _running;

        public static int Port
        {
            get => EditorPrefs.GetInt(PortKey, DefaultPort);
            set => EditorPrefs.SetInt(PortKey, value);
        }

        public static bool Enabled
        {
            get => EditorPrefs.GetBool(EnabledKey, true);
            set => EditorPrefs.SetBool(EnabledKey, value);
        }

        static CodexUnityBridge()
        {
            EditorApplication.update += Pump;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
            if (Enabled) Start();
        }

        [MenuItem("JusticeThrower/Codex Bridge/Toggle")]
        static void ToggleMenu() { if (_running) Stop(); else Start(); }

        [MenuItem("JusticeThrower/Codex Bridge/Restart")]
        static void RestartMenu() { Stop(); Start(); }

        public static void Start()
        {
            if (_running) return;
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add($"http://{Host}:{Port}/");
                _listener.Start();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[CodexBridge] cannot bind {Host}:{Port} - {e.Message}");
                _listener = null;
                return;
            }

            _running = true;
            _thread = new Thread(Loop) { IsBackground = true, Name = "CodexUnityBridge" };
            _thread.Start();
            Debug.Log($"[CodexBridge] listening on http://{Host}:{Port}/");
        }

        public static void Stop()
        {
            if (!_running && _listener == null) return;
            _running = false;
            try { _listener?.Stop(); _listener?.Close(); } catch { /* teardown race */ }
            _listener = null;
            _thread = null;
        }

        static void Loop()
        {
            while (_running)
            {
                HttpListenerContext ctx;
                try { ctx = _listener.GetContext(); }
                catch { break; }

                string body;
                try
                {
                    using (var reader = new System.IO.StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                        body = reader.ReadToEnd();
                }
                catch { body = string.Empty; }

                var item = new WorkItem();
                try { item.Request = string.IsNullOrWhiteSpace(body) ? new JObject() : JObject.Parse(body); }
                catch (Exception e)
                {
                    Write(ctx, 400, Error($"malformed json: {e.Message}"));
                    continue;
                }

                Pending.Enqueue(item);
                if (!item.Done.Wait(RequestTimeoutMs))
                {
                    Write(ctx, 503, Error("editor busy: main thread did not service the request"));
                    continue;
                }
                Write(ctx, item.Response["ok"]?.Value<bool>() == true ? 200 : 422,
                      item.Response.ToString(Formatting.None));
            }
        }

        static void Write(HttpListenerContext ctx, int status, string json)
        {
            try
            {
                var bytes = Encoding.UTF8.GetBytes(json);
                ctx.Response.StatusCode = status;
                ctx.Response.ContentType = "application/json";
                ctx.Response.ContentLength64 = bytes.Length;
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                ctx.Response.OutputStream.Close();
            }
            catch { /* client vanished */ }
        }

        /// <summary>Serialize a JObject payload before writing it to the client.</summary>
        static void Write(HttpListenerContext ctx, int status, JObject json)
            => Write(ctx, status, json.ToString(Formatting.None));

        static JObject Error(string message) => new JObject { ["ok"] = false, ["error"] = message };

        static void Pump()
        {
            while (Pending.TryDequeue(out var item))
            {
                try { item.Response = Dispatch(item.Request); }
                catch (Exception e) { item.Response = Error($"{e.GetType().Name}: {e.Message}"); }
                item.Done.Set();
            }
        }

        static JObject Dispatch(JObject req)
        {
            var op = req.Value<string>("op");
            if (string.IsNullOrEmpty(op)) return Error("missing 'op'");

            switch (op)
            {
                case "ping": return Ping();
                case "project.info": return ProjectInfo();
                case "scene.hierarchy": return Hierarchy();
                case "scene.open": return OpenScene(req);
                case "scene.save": return SaveScene();
                case "gameobject.create": return CreateGameObject(req);
                case "gameobject.delete": return DeleteGameObject(req);
                case "transform.set": return SetTransform(req);
                case "component.add": return AddComponent(req);
                case "component.list": return ListComponents(req);
                case "script.create": return CreateScript(req);
                case "asset.refresh": return RefreshAssets();
                case "menu.execute": return ExecuteMenu(req);
                case "console.tail": return ConsoleTail(req);
                case "play.set": return SetPlayState(req);
                case "bridge.status": return BridgeStatus();
                default: return Error($"unknown op '{op}'");
            }
        }

        static JObject Ping() => new JObject
        {
            ["ok"] = true,
            ["unity"] = Application.unityVersion,
            ["project"] = Application.dataPath,
            ["playing"] = EditorApplication.isPlaying,
            ["compiling"] = EditorApplication.isCompiling,
            ["port"] = Port,
            ["utc"] = DateTime.UtcNow.ToString("o")
        };

        static JObject BridgeStatus() => new JObject
        {
            ["ok"] = true,
            ["running"] = _running,
            ["port"] = Port,
            ["enabled"] = Enabled,
            ["queued"] = Pending.Count
        };

        static JObject ProjectInfo() => new JObject
        {
            ["ok"] = true,
            ["productName"] = Application.productName,
            ["unityVersion"] = Application.unityVersion,
            ["renderPipeline"] = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline != null
                ? UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline.GetType().Name
                : "Built-in",
            ["activeScene"] = SceneManager.GetActiveScene().path,
            ["dirty"] = SceneManager.GetActiveScene().isDirty,
            ["targetFrameRate"] = Application.targetFrameRate,
            ["platform"] = EditorUserBuildSettings.activeBuildTarget.ToString(),
            ["scriptingBackend"] = PlayerSettings.GetScriptingBackend(BuildTargetGroup.Android).ToString()
        };

        static GameObject Resolve(JToken target)
        {
            if (target == null) return null;
            var s = target.ToString();
            if (string.IsNullOrWhiteSpace(s)) return null;

            if (int.TryParse(s, out var id))
            {
                var byId = EditorUtility.InstanceIDToObject(id) as GameObject;
                if (byId != null) return byId;
            }

            var scene = SceneManager.GetActiveScene();
            foreach (var go in scene.GetRootGameObjects())
            {
                if (go.name == s) return go;
                if (s.Contains('/'))
                {
                    var found = go.transform.Find(s);
                    if (found != null) return found.gameObject;
                }
                var deep = FindDeep(go.transform, s);
                if (deep != null) return deep.gameObject;
            }
            return null;
        }

        static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                var hit = FindDeep(root.GetChild(i), name);
                if (hit != null) return hit;
            }
            return null;
        }

        static JObject NodeJson(Transform t)
        {
            var children = new JArray();
            for (int i = 0; i < t.childCount; i++) children.Add(NodeJson(t.GetChild(i)));
            var comps = new JArray();
            foreach (var c in t.gameObject.GetComponents<Component>())
                if (c != null) comps.Add(c.GetType().Name);

            return new JObject
            {
                ["name"] = t.name,
                ["instanceId"] = t.gameObject.GetInstanceID(),
                ["path"] = PathOf(t),
                ["active"] = t.gameObject.activeSelf,
                ["tag"] = t.gameObject.tag,
                ["layer"] = LayerMask.LayerToName(t.gameObject.layer),
                ["position"] = Vec(t.position),
                ["rotation"] = new JObject { ["x"] = t.eulerAngles.x, ["y"] = t.eulerAngles.y, ["z"] = t.eulerAngles.z },
                ["scale"] = Vec(t.localScale),
                ["components"] = comps,
                ["children"] = children
            };
        }

        static JObject Vec(Vector3 v) => new JObject { ["x"] = v.x, ["y"] = v.y, ["z"] = v.z };

        static string PathOf(Transform t)
        {
            var parts = new List<string>();
            var cur = t;
            while (cur != null) { parts.Insert(0, cur.name); cur = cur.parent; }
            return string.Join("/", parts);
        }

        static JObject Hierarchy()
        {
            var roots = new JArray();
            foreach (var go in SceneManager.GetActiveScene().GetRootGameObjects())
                roots.Add(NodeJson(go.transform));
            return new JObject
            {
                ["ok"] = true,
                ["scene"] = SceneManager.GetActiveScene().name,
                ["roots"] = roots
            };
        }

        static JObject OpenScene(JObject req)
        {
            var path = req.Value<string>("path");
            if (string.IsNullOrEmpty(path)) return Error("'path' required");
            var scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
            return new JObject { ["ok"] = true, ["scene"] = scene.name };
        }

        static JObject SaveScene()
        {
            var ok = EditorSceneManager.SaveOpenScenes();
            return new JObject { ["ok"] = ok, ["scene"] = SceneManager.GetActiveScene().path };
        }

        static JObject CreateGameObject(JObject req)
        {
            var name = req.Value<string>("name") ?? "GameObject";
            var primitive = req.Value<string>("primitive");
            GameObject go;
            if (!string.IsNullOrEmpty(primitive) && Enum.TryParse<PrimitiveType>(primitive, true, out var pt))
                go = GameObject.CreatePrimitive(pt);
            else
                go = new GameObject();
            go.name = name;
            var parent = Resolve(req["parent"]);
            if (parent != null) go.transform.SetParent(parent.transform, false);
            Undo.RegisterCreatedObjectUndo(go, "Codex: Create GameObject");

            if (req["position"] != null) go.transform.position = ReadVec(req["position"], Vector3.zero);
            if (req["rotation"] != null) go.transform.eulerAngles = ReadVec(req["rotation"], Vector3.zero);
            if (req["scale"] != null) go.transform.localScale = ReadVec(req["scale"], Vector3.one);

            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            return new JObject { ["ok"] = true, ["path"] = PathOf(go.transform), ["instanceId"] = go.GetInstanceID() };
        }

        static Vector3 ReadVec(JToken t, Vector3 fallback)
        {
            if (t == null || t.Type != JTokenType.Object) return fallback;
            return new Vector3(
                t.Value<float?>("x") ?? fallback.x,
                t.Value<float?>("y") ?? fallback.y,
                t.Value<float?>("z") ?? fallback.z);
        }

        static JObject DeleteGameObject(JObject req)
        {
            var go = Resolve(req["target"]);
            if (go == null) return Error("target not found");
            var path = PathOf(go.transform);
            Undo.DestroyObjectImmediate(go);
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            return new JObject { ["ok"] = true, ["deleted"] = path };
        }

        static JObject SetTransform(JObject req)
        {
            var go = Resolve(req["target"]);
            if (go == null) return Error("target not found");
            Undo.RecordObject(go.transform, "Codex: Set Transform");
            if (req["position"] != null) go.transform.position = ReadVec(req["position"], go.transform.position);
            if (req["rotation"] != null) go.transform.eulerAngles = ReadVec(req["rotation"], go.transform.eulerAngles);
            if (req["scale"] != null) go.transform.localScale = ReadVec(req["scale"], go.transform.localScale);
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            return new JObject
            {
                ["ok"] = true,
                ["path"] = PathOf(go.transform),
                ["position"] = Vec(go.transform.position),
                ["rotation"] = Vec(go.transform.eulerAngles),
                ["scale"] = Vec(go.transform.localScale)
            };
        }

        static Type FindType(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var t = asm.GetType(name, false)
                     ?? asm.GetTypes().FirstOrDefault(x => x.Name == name);
                if (t != null) return t;
            }
            return null;
        }

        static JObject AddComponent(JObject req)
        {
            var go = Resolve(req["target"]);
            if (go == null) return Error("target not found");
            var typeName = req.Value<string>("type");
            var type = FindType(typeName);
            if (type == null) return Error($"type '{typeName}' not found");
            if (!typeof(Component).IsAssignableFrom(type)) return Error($"'{typeName}' is not a Component");

            var existing = go.GetComponent(type);
            if (existing != null) return new JObject { ["ok"] = true, ["added"] = false, ["type"] = type.Name };

            Undo.AddComponent(go, type);
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            return new JObject { ["ok"] = true, ["added"] = true, ["type"] = type.Name };
        }

        static JObject ListComponents(JObject req)
        {
            var go = Resolve(req["target"]);
            if (go == null) return Error("target not found");
            var arr = new JArray();
            foreach (var c in go.GetComponents<Component>())
                if (c != null) arr.Add(c.GetType().FullName);
            return new JObject { ["ok"] = true, ["path"] = PathOf(go.transform), ["components"] = arr };
        }

        static JObject CreateScript(JObject req)
        {
            var rel = req.Value<string>("path");
            if (string.IsNullOrEmpty(rel)) return Error("'path' required, e.g. Assets/Scripts/Ammo.cs");
            if (!rel.StartsWith("Assets/")) return Error("'path' must start with Assets/");

            var full = System.IO.Path.Combine(Application.dataPath, "..", rel);
            if (System.IO.File.Exists(full) && !(req.Value<bool?>("overwrite") ?? false))
                return Error($"'{rel}' already exists (pass overwrite:true)");

            var content = req.Value<string>("content");
            if (string.IsNullOrEmpty(content))
            {
                var ns = req.Value<string>("namespace") ?? "JusticeThrower";
                var cls = req.Value<string>("className") ?? System.IO.Path.GetFileNameWithoutExtension(rel);
                content = $"using UnityEngine;\n\nnamespace {ns}\n{{\n    public class {cls} : MonoBehaviour\n    {{\n    }}\n}}\n";
            }

            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(full));
            System.IO.File.WriteAllText(full, content, new UTF8Encoding(false));
            AssetDatabase.ImportAsset(rel, ImportAssetOptions.ForceUpdate);
            return new JObject { ["ok"] = true, ["path"] = rel };
        }

        static JObject RefreshAssets()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            return new JObject { ["ok"] = true, ["compiling"] = EditorApplication.isCompiling };
        }

        static JObject ExecuteMenu(JObject req)
        {
            var path = req.Value<string>("menuPath");
            if (string.IsNullOrEmpty(path)) return Error("'menuPath' required");
            var ok = EditorApplication.ExecuteMenuItem(path);
            return new JObject { ["ok"] = ok, ["menuPath"] = path };
        }

        static readonly ConcurrentQueue<string> _consoleLines = new ConcurrentQueue<string>();
        static bool _consoleHooked;

        static JObject ConsoleTail(JObject req)
        {
            if (!_consoleHooked)
            {
                Application.logMessageReceived += (msg, stack, type) =>
                {
                    _consoleLines.Enqueue($"[{type}] {msg}");
                    while (_consoleLines.Count > 500) _consoleLines.TryDequeue(out _);
                };
                _consoleHooked = true;
            }

            var count = req.Value<int?>("count") ?? 50;
            var arr = new JArray(_consoleLines.Reverse().Take(count).Reverse());
            return new JObject { ["ok"] = true, ["lines"] = arr };
        }

        static JObject SetPlayState(JObject req)
        {
            var state = (req.Value<string>("state") ?? "play").ToLowerInvariant();
            switch (state)
            {
                case "play":
                    if (!EditorApplication.isPlaying) EditorApplication.isPlaying = true;
                    break;
                case "stop":
                    if (EditorApplication.isPlaying) EditorApplication.isPlaying = false;
                    break;
                case "pause":
                    EditorApplication.isPaused = !EditorApplication.isPaused;
                    break;
                default:
                    return Error("state must be play|stop|pause");
            }
            return new JObject { ["ok"] = true, ["state"] = state, ["playing"] = EditorApplication.isPlaying };
        }
    }
}
#endif