# Supabase 云端同步配置

## 1. 创建数据表

在 Supabase Dashboard 的 SQL Editor 中执行项目根目录的
`supabase-schema.sql`。

## 2. 填写浏览器端配置

编辑 `js/supabase.js`：

```js
export const SUPABASE_CONFIG = {
  url: 'https://你的项目.supabase.co',
  anonKey: '你的 Supabase anon key',
  familyId: '00000000-0000-0000-0000-000000000001'
};
```

`anonKey` 可以出现在浏览器代码中，真正的数据访问权限由 Supabase RLS
策略控制。当前 SQL 是“无登录的共享家庭”模式：知道网站地址及客户端配置的
人都能读写这一行，请勿保存敏感信息。

## 3. 首次迁移规则

- 云端已有 `familyId` 对应记录：使用云端数据并更新本机缓存。
- 云端没有记录：读取 `family-menu-planner-v2`；存在旧数据时上传旧数据，
  否则上传 `defaultState()`。
- Supabase 未配置或网络暂时不可用：继续使用本地缓存，页面不会停止运行。
- 云端初始化或请求超过 8 秒：自动回退到本地缓存，并显示同步提示。

## 4. Cloudflare Pages

这是纯静态 ES Modules 项目，不需要 Node、Express 或 Workers 后端。

- 保持 `js/supabase.js` 可被部署。
- Supabase Dashboard 中将正式站点域名加入允许的 URL 配置。
- CDN 依赖来自 `cdn.jsdelivr.net`。如果站点配置了 CSP，需要允许：
  `script-src https://cdn.jsdelivr.net` 和
  `connect-src https://*.supabase.co wss://*.supabase.co`。
- 部署前不要在仓库中放 `service_role` key，只能使用 anon key。

## 5. 当前同步模型的限制

整个应用状态保存在一条 `jsonb` 记录中，采用最后写入覆盖策略。两台设备同时
编辑时，最后一次保存会覆盖先前版本。下一阶段若需要多人实时协作，应加入登录、
家庭成员权限和版本冲突检测。

菜品图片目前仍以 Base64 包含在 state 中。少量图片可正常工作；大量图片应迁移
到 Supabase Storage，并在 state 中只保存图片 URL。
