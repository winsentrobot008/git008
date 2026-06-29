# preview-changes.ps1 — 预览 Maneki-AI → AI-WORKFLOW 重命名变更
# 列出所有将被替换的文件与行

$root = "c:\Users\aoogoost\Desktop\Projekt\git008"

Write-Host "=== 预览 Maneki-AI → AI-WORKFLOW 重命名变更 ===" -ForegroundColor Cyan
Write-Host ""

$patterns = @(
    @{Name="Maneki-AI (项目名)"; Pattern='Maneki-AI'},
    @{Name="maneki-ai (小写)"; Pattern='maneki-ai'},
    @{Name="ManekiAI (驼峰)"; Pattern='ManekiAI'}
)

foreach ($p in $patterns) {
    Write-Host "--- 搜索: $($p.Name) ---" -ForegroundColor Yellow
    $results = Select-String -Path (Get-ChildItem -Path $root -Recurse -File -Include @("*.md","*.py","*.yaml","*.yml","*.json","*.txt","*.html","*.js","*.clinerules","*.cfg","*.toml") | Where-Object { $_.FullName -notmatch '\\.git\\' -and $_.FullName -notmatch 'node_modules' -and $_.FullName -notmatch '__pycache__' -and $_.FullName -notmatch '\\.venv' -and $_.FullName -notmatch 'package-lock\\.json' }).FullName -Pattern $p.Pattern -SimpleMatch | Group-Object Path
    
    $total = 0
    foreach ($r in $results) {
        $relPath = $r.Name.Replace($root, '')
        Write-Host "  $relPath ($($r.Count) 行)" -ForegroundColor Gray
        $total += $r.Count
    }
    Write-Host "  总计: $total 处匹配" -ForegroundColor Green
    Write-Host ""
}
