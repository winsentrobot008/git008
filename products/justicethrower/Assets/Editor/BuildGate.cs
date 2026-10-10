#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace JusticeThrower.Editor
{
    /// <summary>
    /// Headless gate: verifies a clean C# compile AND that the URP pipeline asset is wired.
    /// Invoke with:
    ///   Unity.exe -batchmode -quit -nographics -projectPath &lt;project&gt; \
    ///             -logFile Logs/compile-gate.log \
    ///             -executeMethod JusticeThrower.Editor.BuildGate.Compile
    /// Exit code 0 = green (compile clean + URP wired). Non-zero = red.
    /// </summary>
    public static class BuildGate
    {
        public static void Compile()
        {
            if (EditorUtility.scriptCompilationFailed)
            {
                Debug.LogError("[BuildGate] FAIL: C# compilation errors present.");
                EditorApplication.Exit(1);
                return;
            }
            Debug.Log("[BuildGate] OK: C# compilation clean.");

            UrpBootstrap.EnsureConfigured();

            var graphicsPipeline = GraphicsSettings.defaultRenderPipeline;
            var qualityPipeline = QualitySettings.renderPipeline;

            Debug.Log($"[BuildGate] GraphicsSettings.defaultRenderPipeline = {(graphicsPipeline != null ? graphicsPipeline.name : "<null>")}");
            Debug.Log($"[BuildGate] QualitySettings.renderPipeline          = {(qualityPipeline != null ? qualityPipeline.name : "<null>")}");

            if (!(graphicsPipeline is UniversalRenderPipelineAsset))
            {
                Debug.LogError("[BuildGate] FAIL: GraphicsSettings.defaultRenderPipeline is not a UniversalRenderPipelineAsset.");
                EditorApplication.Exit(1);
                return;
            }

            if (!(qualityPipeline is UniversalRenderPipelineAsset))
            {
                Debug.LogError("[BuildGate] FAIL: QualitySettings.renderPipeline is not a UniversalRenderPipelineAsset.");
                EditorApplication.Exit(1);
                return;
            }

            Debug.Log("[BuildGate] PASS: compile clean + URP wired.");
            EditorApplication.Exit(0);
        }
    }
}
#endif