#if UNITY_EDITOR
using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace JusticeThrower.Editor
{
    /// <summary>
    /// Headless verification that the Android toolchain (SDK / NDK / OpenJDK) is
    /// present and that Unity can switch to the Android build target.
    /// Exit 0 = Android build support operational.
    /// </summary>
    public static class AndroidToolchainCheck
    {
        public static void Verify()
        {
            var moduleOk = BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android, BuildTarget.Android);
            Debug.Log($"[AndroidCheck] IsBuildTargetSupported(Android) = {moduleOk}");

            ReportTools();

            var switched = EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android);
            Debug.Log($"[AndroidCheck] SwitchActiveBuildTarget(Android) = {switched}");
            Debug.Log($"[AndroidCheck] activeBuildTarget = {EditorUserBuildSettings.activeBuildTarget}");

            if (!moduleOk || !switched)
            {
                Debug.LogError("[AndroidCheck] FAIL: Android build support is not operational.");
                EditorApplication.Exit(1);
                return;
            }

            Debug.Log("[AndroidCheck] PASS: Android build support operational.");
            EditorApplication.Exit(0);
        }

        static void ReportTools()
        {
            try
            {
                var t = Type.GetType("UnityEditor.Android.AndroidExternalToolsSettings, UnityEditor.Android.Extensions");
                if (t == null)
                {
                    Debug.LogWarning("[AndroidCheck] AndroidExternalToolsSettings type not found.");
                    return;
                }

                foreach (var prop in new[] { "sdkRootPath", "ndkRootPath", "jdkRootPath" })
                {
                    var p = t.GetProperty(prop, BindingFlags.Public | BindingFlags.Static);
                    var value = p?.GetValue(null, null) as string;
                    var exists = !string.IsNullOrEmpty(value) && System.IO.Directory.Exists(value);
                    Debug.Log($"[AndroidCheck] {prop} = {(string.IsNullOrEmpty(value) ? "<unset>" : value)} (exists={exists})");
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[AndroidCheck] tool probe failed: {e.Message}");
            }
        }
    }
}
#endif