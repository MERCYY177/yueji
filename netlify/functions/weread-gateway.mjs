const UPSTREAM = "https://i.weread.qq.com/api/agent/gateway";

const ALLOWED_APIS = new Set([
  "/_list",
  "/readdata/detail",
  "/shelf/sync",
  "/book/getprogress",
  "/user/notebooks",
  "/book/bookmarklist",
  "/review/list/mine"
]);

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });

export default async (request) => {
  if (request.method !== "POST") {
    return json({ message: "只允许 POST 请求" }, 405, { allow: "POST" });
  }

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || authorization.length < 20) {
    return json({ message: "缺少有效的微信读书 Skill Key" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "请求内容不是有效 JSON" }, 400);
  }

  const apiName = String(payload?.api_name || "");
  if (!ALLOWED_APIS.has(apiName)) {
    return json({ message: "这个微信读书接口不在阅迹允许列表中" }, 403);
  }

  const safePayload = {
    ...payload,
    api_name: apiName,
    skill_version: String(payload?.skill_version || "1.0.5")
  };

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(safePayload)
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    console.error("WeRead gateway failed", error);
    return json({ message: "暂时无法连接微信读书，请稍后重试" }, 502);
  }
};
