# 部署说明

本项目是静态网站，不需要构建命令、数据库或环境变量。

## Netlify

将整个 `family-menu-planner` 文件夹拖进 Netlify 的 Deploy 页面；发布目录选择项目根目录。

## Vercel

导入该文件夹所在的 Git 仓库，Framework Preset 选择 `Other`，Build Command 留空，Output Directory 选择 `.`。

## GitHub Pages

把本目录内容推送到仓库根目录，并在 Pages 中选择从分支根目录部署。

## 数据说明

菜库、计划和采购勾选保存在访问者本机浏览器。部署后，每位访问者拥有独立数据；若需要家人之间共享，请继续接入数据库和登录系统。
