# apply-changes.ps1 — 执行 Maneki-AI → AI-WORKFLOW 批量替换
# 此脚本与 rename_script.ps1 功能相同，适合在需要重新执行替换时使用

$root = "c:\Users\aoogoost\Desktop\Projekt\git008"

# Step 1: 确保 AI-WORKFLOW 目录存在
if (-not (Test-Path "$root\AI-WORKFLOW")) {
    if (Test-Path "$root\Maneki-AI") {
        Write-Host "重命名目录 Maneki-AI → AI-WORKFLOW..."
        Rename-Item -Path "$root\Maneki-AI" -NewName "AI-WORKFLOW"
    } else {
        Write-Host "错误: 找不到 Maneki-AI 目录" -ForegroundColor Red
        exit 1
    }
}

# Step 2: 批量文本替换
$extensions = @("*.md", "*.py", "*.yaml", "*.yml", "*.json", "*.txt", "*.html", "*.css", "*.js", "*.sh", "*.bat", "*.cfg", "*.toml", "*.dockerfile", "*.clinerules")
$excludeDirs = @("\.git", "node_modules", "__pycache__", "\.venv")

$files = Get-ChildItem -Path $root -Recurse -File -Include $extensions | Where-Object {
    $skip = $false
    foreach ($ex in $excludeDirs) { if ($_.FullName -match $ex) { $skip = $true; break } }
    -not $skip -and $_.FullName -notmatch "package-lock\.json"
}

$totalReplaced = 0

foreach ($file in $files) {
    try {
        $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8 -ErrorAction Stop
        $original = $content
        
        # Pattern 1: Maneki-AI → AI-WORKFLOW (whole word, not part of URLs)
        $content = $content -replace '(?<![\/\w.])Maneki-AI(?![\/\w.-])', 'AI-WORKFLOW'
        # Pattern 2: maneki-ai → ai-workflow
        $content = $content -replace '(?<![\/\w.])maneki-ai(?![\/\w.-])', 'ai-workflow'
        # Pattern 3: ManekiAI → AIWORKFLOW
        $content = $content -replace '(?<![\/\w])ManekiAI(?![\/\w])', 'AIWORKFLOW'
        # Pattern 4: "Maneki-AI" in quotes
        $content = $content -replace '"Maneki-AI"', '"AI-WORKFLOW"'
        
        if ($content -ne $original) {
            $content | Set-Content -Path $file.FullName -NoNewline -Encoding UTF8 -Force
            $totalReplaced++
        }
    } catch {
        # Skip binary/unreadable files silently
    }
}

Write-Host "替换完成! 共处理 $totalReplaced 个文件。" -ForegroundColor Green
Write-Host ""
Write-Host "后续步骤:" -ForegroundColor Cyan
Write-Host "  1. 验证变更: git diff --stat" -ForegroundColor Gray
Write-Host "  2. 提交变更: git add -A && git commit -m 'chore(rename): Maneki-AI → AI-WORKFLOW'" -ForegroundColor Gray
Write-Host "  3. 推送分支: git push origin rename/maneki-to-ai-workflow" -ForegroundColor Gray
