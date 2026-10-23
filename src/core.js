export const SOURCE = 'https://www.koreabaseball.com/kbo/league/map.aspx';
export const VERIFIED_AT = '2026-10-06';
// Host patterns use Chrome match-pattern semantics: '*.example.com' matches example.com and its subdomains,
// a bare host matches only itself. HOST_PERMISSIONS (manifest.json) is derived from the same list; a unit test
// keeps both in sync so allowedUrl() never accepts a host the extension has no permission for (or vice versa).
const ticketlink = { provider: '티켓링크', url: 'https://www.ticketlink.co.kr/sports/baseball', hosts: ['*.ticketlink.co.kr'] };
// NOL 티켓 (구 인터파크 티켓): 예매 창이 열리는 인터파크 티켓 하위 도메인만 허용한다. 실서비스 경로는 미검증 — docs/SOURCES.md.
const nol = { provider: 'NOL 티켓', hosts: ['nol.yanolja.com', 'ticket.interpark.com', 'tickets.interpark.com', 'poticket.interpark.com'] };
export const TEAMS = [
  { id: 'lg', name: 'LG 트윈스', short: 'LG', color: '#b61b55', ...ticketlink },
  { id: 'hanwha', name: '한화 이글스', short: '한화', color: '#d65210', ...ticketlink },
  { id: 'samsung', name: '삼성 라이온즈', short: '삼성', color: '#2466c6', ...ticketlink },
  { id: 'kt', name: 'KT 위즈', short: 'KT', color: '#252a32', ...ticketlink },
  { id: 'kia', name: 'KIA 타이거즈', short: 'KIA', color: '#bd2538', ...ticketlink },
  { id: 'doosan', name: '두산 베어스', short: '두산', color: '#253b70', ...nol, url: 'https://nol.yanolja.com/ticket/genre/sports/bears' },
  { id: 'kiwoom', name: '키움 히어로즈', short: '키움', color: '#852448', ...nol, url: 'https://nol.yanolja.com/ticket/genre/sports/heroes' },
  { id: 'ssg', name: 'SSG 랜더스', short: 'SSG', color: '#b82537', provider: 'SSG 전용 예매', url: 'https://ticket.ssg.com/', hosts: ['ticket.ssg.com'] },
  { id: 'lotte', name: '롯데 자이언츠', short: '롯데', color: '#277d96', provider: '롯데 전용 예매', url: 'https://ticket.giantsclub.com/', hosts: ['ticket.giantsclub.com'] },
  { id: 'nc', name: 'NC 다이노스', short: 'NC', color: '#315987', provider: 'NC 전용 예매', url: 'https://ticket.ncdinos.com/', hosts: ['ticket.ncdinos.com'] },
];
export const HOST_PERMISSIONS = [...new Set(TEAMS.flatMap(t => t.hosts))].map(h => `https://${h}/*`);
// One headcount limit for the dashboard memo and the macro. Actual purchase limits are set by each ticket site.
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 6;
export const validQuantity = n => Number.isInteger(n) && n >= MIN_QUANTITY && n <= MAX_QUANTITY;
export const MAX_URL_LENGTH = 2048;
export const STATES = { scheduled: '오픈 대기', opening: '페이지 여는 중', watching: '예매 버튼 확인 중', available: '예매 버튼 발견', handoff: '직접 진행 필요', clicked: '예매 버튼 클릭', stopped: '중지됨', expired: '예약 시간 지남', error: '확인 필요' };
export const ACTIVE = new Set(['scheduled', 'opening', 'watching']);
export const EDITABLE = new Set(['scheduled', 'stopped', 'expired', 'error', 'handoff', 'available']);
export const RESTARTABLE = new Set(['stopped', 'expired', 'error', 'handoff', 'available']);
export const teamById = id => TEAMS.find(t => t.id === id);
export const teamName = id => teamById(id)?.name || `알 수 없는 구단(${String(id ?? '').slice(0, 20)})`;
const hostMatches = (hostname, pattern) => pattern.startsWith('*.')
  ? hostname === pattern.slice(2) || hostname.endsWith(pattern.slice(1))
  : hostname === pattern;
export function allowedUrl(raw, team) {
  try {
    const u = new URL(raw);
    return !!team && u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && team.hosts.some(h => hostMatches(u.hostname, h));
  } catch { return false; }
}
// Query/hash parameters that can carry login sessions or personal data. Names are compared after lowercasing and
// removing '-', '_' and '.'; game identifiers such as GoodsCode/productId/scheduleNo are kept.
const SENSITIVE_EXACT = new Set(['code', 'state', 'sid', 'auth', 'authorization', 'key', 'apikey', 'pw', 'pwd', 'passwd', 'otp', 'sig', 'signature', 'jwt', 'ticket', 'email', 'phone', 'mobile', 'userid', 'uid', 'memberid', 'memberno', 'nonce', 'name', 'birth']);
const SENSITIVE_PART = /token|session|sessid|password|secret|credential|cookie|oauth|saml/;
export const sensitiveParam = name => { const key = String(name).toLowerCase().replace(/[-_.]/g, ''); return SENSITIVE_EXACT.has(key) || SENSITIVE_PART.test(key); };
export function sanitizeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return raw; }
  for (const name of [...new Set(u.searchParams.keys())]) if (sensitiveParam(name)) u.searchParams.delete(name);
  if (u.hash.includes('=')) {
    const params = new URLSearchParams(u.hash.slice(1).replace(/^[^?]*\?/, ''));
    if ([...params.keys()].some(sensitiveParam)) u.hash = '';
  }
  u.username = ''; u.password = '';
  return u.href;
}
export function parseKst(input) {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(input)) return NaN;
  const ms = Date.parse(input + '+09:00');
  if (!Number.isFinite(ms)) return NaN;
  const canonical = new Date(ms + 9 * 3600000).toISOString().slice(0, input.length);
  return canonical === input ? ms : NaN;
}
export function validatePlan(input, now = Date.now(), { allowPastOpen = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('예약 형식을 확인해 주세요.');
  const team = teamById(input.teamId);
  if (!team) throw new Error('홈 구단을 선택해 주세요.');
  const gameAt = parseKst(input.gameAt || '');
  const openAt = parseKst(input.openAt || '');
  if (!Number.isFinite(gameAt) || gameAt <= now) throw new Error('미래의 경기 날짜와 시간을 입력해 주세요.');
  if (!Number.isFinite(openAt) || (!allowPastOpen && openAt <= now)) throw new Error('예매 오픈 시간을 현재보다 뒤로 설정해 주세요.');
  if (openAt > gameAt) throw new Error('예매 오픈은 경기 시작 전이어야 합니다.');
  const opponent = teamById(input.opponentId);
  if (!opponent || opponent.id === team.id) throw new Error('다른 상대 구단을 선택해 주세요.');
  const rawUrl = String(input.url || team.url).trim();
  if (rawUrl.length > MAX_URL_LENGTH) throw new Error('예매 주소가 너무 깁니다.');
  if (!allowedUrl(rawUrl, team)) throw new Error('선택한 구단의 공식 예매처 HTTPS 주소를 입력해 주세요.');
  const url = sanitizeUrl(rawUrl);
  const quantity = Number(input.quantity);
  if (!validQuantity(quantity)) throw new Error(`희망 인원은 ${MIN_QUANTITY}~${MAX_QUANTITY}명으로 입력해 주세요. 실제 구매 한도는 예매처를 따릅니다.`);
  const watchMinutes = Number(input.watchMinutes ?? 5);
  if (![1, 3, 5, 10].includes(watchMinutes)) throw new Error('확인 시간은 1·3·5·10분 중 선택해 주세요.');
  const reminderMinutes = Number(input.reminderMinutes ?? 5);
  if (![0, 1, 3, 5, 10, 30].includes(reminderMinutes)) throw new Error('준비 알림 시간을 확인해 주세요.');
  return { reminderMinutes, teamId: team.id, opponentId: opponent.id, gameAt: input.gameAt, openAt, url, quantity, section: String(input.section || '').trim().slice(0, 100), autoClick: input.autoClick === true, watchMinutes };
}
export function dueAction(plan, now) {
  if (plan.state !== 'scheduled' || now < plan.openAt) return 'wait';
  return now - plan.openAt > 60000 ? 'expire' : 'open';
}
export function displayKst(ms) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ms);
}
export function toKstInput(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 19); }
export function planInput(plan) {
  return { teamId: plan.teamId, opponentId: plan.opponentId, gameAt: plan.gameAt, openAt: toKstInput(plan.openAt), url: sanitizeUrl(plan.url), quantity: plan.quantity, section: plan.section, autoClick: plan.autoClick === true, watchMinutes: plan.watchMinutes, reminderMinutes: plan.reminderMinutes ?? 5 };
}
// Same home team + same start instant ('18:30' and '18:30:00' are one game).
export const planKey = plan => plan.teamId + ':' + parseKst(plan.gameAt);
export const MAX_BACKUP = 100;
// Only upcoming games are exported; finished games cannot be restored anyway.
export function buildBackup(plans, now = Date.now()) {
  const upcoming = plans.filter(p => parseKst(p.gameAt) > now);
  if (upcoming.length > MAX_BACKUP) throw new Error(`예정된 예약이 ${upcoming.length}건입니다. 백업은 최대 ${MAX_BACKUP}건이니 필요 없는 예약을 정리해 주세요.`);
  return { format: 'first-pitch', version: 1, exportedAt: new Date(now).toISOString(), plans: upcoming.map(planInput) };
}
export function readBackup(data, existing = [], now = Date.now()) {
  if (!data || data.format !== 'first-pitch' || data.version !== 1 || !Array.isArray(data.plans)) throw new Error('첫 공 백업 파일을 선택해 주세요.');
  if (data.plans.length > MAX_BACKUP) throw new Error(`백업 파일의 예약이 ${data.plans.length}건입니다. 한 번에 최대 ${MAX_BACKUP}건까지 복원합니다.`);
  const seen = new Set(existing.map(planKey));
  const imported = []; let skipped = 0;
  for (const raw of data.plans) {
    // Validate every row before returning. IDs, state, tabs and run tokens are never imported.
    const plan = validatePlan(raw, 0, { allowPastOpen: true });
    const key = planKey(plan);
    if (parseKst(plan.gameAt) <= now || seen.has(key)) { skipped++; continue; }
    seen.add(key); imported.push({ ...plan, autoClick: false });
  }
  return { imported, skipped };
}
export const reminderAt = plan => plan.openAt - (plan.reminderMinutes ?? 5) * 60000;
// A reminder is sent once, inside [reminderAt, openAt). It is skipped when its time had already passed when the
// plan was (re)scheduled, or when it is more than a minute late (sleep/browser closed) — same rule as late opens.
export function reminderDue(plan, now = Date.now()) {
  const minutes = plan.reminderMinutes ?? 5;
  if (plan.state !== 'scheduled' || !(minutes > 0) || plan.reminderSentAt) return false;
  const at = reminderAt(plan);
  if ((plan.scheduledAt ?? plan.createdAt ?? 0) > at) return false;
  return now >= at && now < plan.openAt && now - at <= 60000;
}
