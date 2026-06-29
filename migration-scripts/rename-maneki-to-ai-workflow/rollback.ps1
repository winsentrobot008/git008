# rollback.ps1 — Maneki-AI → AI-WORKFLOW 重命名回滚脚本
# 基于备份分支恢复所有变更

$root = "c:\Users\aoogoost\Desktop\Projekt\git008"
$backupBranch = "rename/maneki-to-ai-workflow-backup"
$currentBranch = "rename/maneki-to-ai-workflow"

Write-Host "=== Maneki-AI → AI-WORKFLOW 回滚脚本 ===" -ForegroundColor Cyan
Write-Host ""

# 方法1: 从备份分支恢复（推荐）
Write-Host "方法1: 从备份分支恢复（推荐）" -ForegroundColor Yellow
Write-Host "  1. 确保当前工作区干净: git status" -ForegroundColor Gray
Write-Host "  2. 切换到备份分支: git checkout $backupBranch" -ForegroundColor Gray
Write-Host "  3. 从备份分支创建新分支继续工作" -ForegroundColor Gray
Write-Host ""

# 方法2: 重置当前分支到备份分支
Write-Host "方法2: 重置当前分支到备份分支" -ForegroundColor Yellow
Write-Host "  git checkout $currentBranch" -ForegroundColor Gray
Write-Host "  git reset --hard $backupBranch" -ForegroundColor Gray
Write-Host ""

# 方法3: 手动恢复目录名和文件
Write-Host "方法3: 手动恢复" -ForegroundColor Yellow
Write-Host "  # 恢复目录名" -ForegroundColor Gray
Write-Host "  if (Test-Path 'AI-WORKFLOW') { Move-Item 'AI-WORKFLOW' 'Maneki-AI' -Force }" -ForegroundColor Gray
Write-Host ""
Write-Host "  # 删除迁移脚本目录" -ForegroundColor Gray
Write-Host "  Remove-Item -Recurse -Force 'migration-scripts/rename-maneki-to-ai-workflow' -ErrorAction SilentlyContinue" -ForegroundColor Gray
Write-Host "  Remove-Item -Recurse -Force 'docs/rename-maneki-to-ai-workflow.md' -ErrorAction SilentlyContinue" -ForegroundColor Gray
Write-Host "  Remove-Item -Force 'rename_script.ps1' -ErrorAction SilentlyContinue" -ForegroundColor Gray
Write-Host ""

Write-Host "注意: 如果已经推送到远程，回滚后需要 force push:" -ForegroundColor Red
Write-Host "  git push origin $currentBranch --force-with-lease" -ForegroundColor Gray
