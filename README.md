# 阅迹

阅迹是一个本地优先的阅读档案网页，可导入静读天下备份，并通过 Netlify Function 同步微信读书数据。

## 开发与验证

需要 Node.js 22+。安装依赖后运行：

```sh
npm ci
npm run check
```

`npm run build` 会生成 `dist/`。Netlify 正式部署仍从仓库根目录发布，以便同时部署 `netlify/functions`。

## 数据与隐私

主体档案保存在 `localStorage`；书摘、封面和微信同步增量保存在 IndexedDB。升级不会更改已有数据库名、object store 或记录 key。微信读书 Skill Key 默认只在当前标签页保存，也可由用户明确选择保存在此设备。

导出 JSON 前请保留一份备份。不要清理浏览器网站数据，否则本地档案和 IndexedDB 内容可能丢失。

## 部署

项目面向 Netlify。微信同步依赖 `/.netlify/functions/weread-gateway`，纯 GitHub Pages 部署不具备该函数。部署前应先运行完整检查，成功后再执行一次生产部署。
