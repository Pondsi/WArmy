/**
 * **网络配置与多服务器扇出**（第 59 轮用户口径）。
 *
 * 需求拆成可执行的东西：
 *  · 局域网 / 有公网 IP ⇒ 可只用"自己的网关"（不配服务器）；
 *  · 无公网 IP 且不在局域网 ⇒ **必须**至少配一个服务器；
 *  · 可同时连多个服务器；**按会话（联系人/群聊/项目）**选择用哪些，可多选；
 *  · 发送时把同一条消息发给该会话配置的**所有**网络，任一网络送达就算送达；其它网络失败要如实记录、重试；
 *  · 服务器用**凭据**确认"你有权使用"；设置里可配公网 IP、多个服务器地址+凭据。
 *
 * 这里是纯逻辑 + 一个扇出函数（传输用注入的 send，便于门禁 mock）；
 * UI（设置页、第四列网络设置卡）与真实 P2P/网关还没接。
 */

export type WangLuoFuWu = { id: string; name: string; url: string; credential: string };
export type WangLuoPeiZhi = { servers: WangLuoFuWu[]; publicIp?: string; gongWangWangGuan?: string };
export type BangDing = Record<string, string[]>; // sessionId → serverId[]

/** 校验一条服务器：http/https、有名字、有凭据；返回可读错误（不抛） */
export function jianChaFuWu(s: Partial<WangLuoFuWu>, yiYou: WangLuoFuWu[] = []): { ok: boolean; why: string[] } {
  const why: string[] = [];
  const url = String(s.url || '').trim();
  if (!url) why.push('地址为空');
  else {
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) why.push('只支持 http/https'); } catch { why.push('地址不是合法 URL'); }
  }
  if (!String(s.name || '').trim()) why.push('名称不能为空（多个服务器要分得清）');
  if (!String(s.credential || '').trim()) why.push('缺少凭据（服务器要用它确认你有权使用）');
  if (yiYou.some((x) => x.name === String(s.name || '').trim())) why.push('名称重复');
  if (yiYou.some((x) => String(x.url || '').replace(/\/$/, '') === url.replace(/\/$/, ''))) why.push('地址重复');
  return { ok: why.length === 0, why };
}

/** 会话绑定的服务器：去重、剔除已不存在的 id（服务器被删了不能继续发） */
export function youXiaoBangDing(bang: string[], servers: WangLuoFuWu[]): string[] {
  const you = new Set(servers.map((s) => s.id));
  return [...new Set((Array.isArray(bang) ? bang : []).filter((id) => you.has(id)))];
}

/** 这条会话"至少要有一个网络"：局域网/网关可用时可为空；否则必须至少一个服务器 */
export function wangLuoGouYong(q: { bang: string[]; servers: WangLuoFuWu[]; juYuWang: boolean; gongWangWangGuan: boolean }): { ok: boolean; reason: string } {
  const xuan = youXiaoBangDing(q.bang, q.servers);
  if (q.juYuWang || q.gongWangWangGuan) return { ok: true, reason: '' };
  if (xuan.length) return { ok: true, reason: '' };
  return { ok: false, reason: '没有公网 IP 也不在局域网 ⇒ 必须至少选择一个服务器' };
}

export type TouDiJieGuo = { serverId: string; ok: boolean; offline?: boolean; error?: string };

/**
 * **多服务器扇出**：同一条消息发给所有选中的服务器。
 * 语义：任一成功 ⇒ 整体送达（`ok:true`）；全部失败 ⇒ `ok:false` 并带每台的原因（供重试/显示"未送达"）。
 * 不抛异常：单个服务器挂了不许拖垮其它服务器（这是"多网络"存在的意义）。
 */
export async function touDiDaoSuoYou(
  servers: WangLuoFuWu[],
  bang: string[],
  send: (s: WangLuoFuWu) => Promise<{ ok: boolean; offline?: boolean; error?: string }>,
): Promise<{ ok: boolean; results: TouDiJieGuo[] }> {
  const xuan = youXiaoBangDing(bang, servers).map((id) => servers.find((s) => s.id === id)!).filter(Boolean);
  const results: TouDiJieGuo[] = [];
  await Promise.all(xuan.map(async (s) => {
    try {
      const r = await send(s);
      results.push({ serverId: s.id, ok: !!r.ok, offline: !!r.offline, error: r.error });
    } catch (e) {
      results.push({ serverId: s.id, ok: false, error: String((e as Error)?.message || e).slice(0, 100) });
    }
  }));
  return { ok: results.some((r) => r.ok), results };
}

/** 把同一份"加入请求/消息"要发给哪些网络：返回去重后的服务器对象（UI/发送侧共用） */
export function yaoFaGeiNaXie(servers: WangLuoFuWu[], bang: string[]): WangLuoFuWu[] {
  const xuan = new Set(youXiaoBangDing(bang, servers));
  return servers.filter((s) => xuan.has(s.id));
}
