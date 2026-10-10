#if UNITY_EDITOR
using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace JusticeThrower.Editor
{
    /// <summary>
    /// Idempotent URP wiring for the greenfield project.
    /// Creates the pipeline asset + renderer data if missing, then binds them to
    /// Graphics/Quality settings. Safe to call repeatedly (every editor load and
    /// every headless gate run).
    /// </summary>
    [InitializeOnLoad]
    public static class UrpBootstrap
    {
        const string SettingsDir = "Assets/Settings";
        const string PipelineAssetPath = SettingsDir + "/JusticeThrower_URP.asset";
        const string RendererDataPath = SettingsDir + "/JusticeThrower_Renderer.asset";

        static UrpBootstrap()
        {
            EditorApplication.delayCall += EnsureConfigured;
        }

        [MenuItem("JusticeThrower/Setup/Configure URP")]
        public static void EnsureConfigured()
        {
            try
            {
                if (!AssetDatabase.IsValidFolder(SettingsDir))
                    AssetDatabase.CreateFolder("Assets", "Settings");

                var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelineAssetPath);
                if (pipeline == null)
                {
                    var rendererData = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererDataPath);
                    if (rendererData == null)
                    {
                        rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
                        AssetDatabase.CreateAsset(rendererData, RendererDataPath);
                    }

                    pipeline = UniversalRenderPipelineAsset.Create(rendererData);
                    AssetDatabase.CreateAsset(pipeline, PipelineAssetPath);
                    AssetDatabase.SaveAssets();
                    Debug.Log($"[UrpBootstrap] created {PipelineAssetPath}");
                }

                if (!ReferenceEquals(GraphicsSettings.defaultRenderPipeline, pipeline))
                {
                    GraphicsSettings.defaultRenderPipeline = pipeline;
                    Debug.Log("[UrpBootstrap] bound pipeline -> GraphicsSettings.defaultRenderPipeline");
                }

                if (!ReferenceEquals(QualitySettings.renderPipeline, pipeline))
                {
                    QualitySettings.renderPipeline = pipeline;
                    Debug.Log("[UrpBootstrap] bound pipeline -> QualitySettings.renderPipeline");
                }

                AssetDatabase.SaveAssets();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[UrpBootstrap] auto-config failed: {e.Message}. Assign the pipeline asset manually via Project Settings > Graphics.");
            }
        }
    }
}
#endif