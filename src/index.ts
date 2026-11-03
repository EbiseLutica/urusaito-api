import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';
import { timingSafeEqual } from 'hono/utils/buffer';

type Bindings = {
	DB: D1Database;
	API_KEY: string;
	LIKE_LIMITER: RateLimit;
};

type GyaguRow = {
	id: number;
	text: string;
	summary: string | null;
	url: string | null;
	likes: number;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

/**
 * `Authorization: Bearer <API_KEY>` を要求する。
 * API_KEY 未設定時は全リクエストを拒否する。
 */
const requireApiKey = bearerAuth<{ Bindings: Bindings }>({
	verifyToken: async (token, c) => !!c.env.API_KEY && (await timingSafeEqual(token, c.env.API_KEY)),
});

/** `?order=` で指定できる並び順と ORDER BY 句の対応。いいね数が同じなら新しい順。 */
const ORDER_CLAUSES = new Map([
	['id-asc', 'id ASC'],
	['id-desc', 'id DESC'],
	['likes-asc', 'likes ASC, id DESC'],
	['likes-desc', 'likes DESC, id DESC'],
]);

/**
 * だじゃれ一覧を返す。
 * `?order=` で並び順を指定する（id-asc / id-desc / likes-asc / likes-desc）。省略時は id-desc。
 */
app.get('/', async (c) => {
	const order = c.req.query('order') || 'id-desc';
	const orderBy = ORDER_CLAUSES.get(order);
	if (orderBy == null) {
		return c.json({ error: `order must be one of ${[...ORDER_CLAUSES.keys()].join(', ')}` }, 400);
	}

	const { results } = await c.env.DB.prepare(`SELECT id, text, summary, url, likes FROM gyagus ORDER BY ${orderBy}`).all<GyaguRow>();
	return c.json(results.map((g) => ({
		id: g.id,
		text: g.text,
		summary: g.summary,
		url: g.url,
		likes: g.likes,
	})));
});

const SITE_URL = 'https://lutic.at/gyagu';

const escapeXml = (s: string) => s
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')
	.replace(/'/g, '&apos;');

/**
 * ギャグ一覧の RSS 2.0 フィード。新しい順。
 * ギャグに日付は無いので pubDate は付けず、guid に ID を使う。
 */
app.get('/rss.xml', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT id, text, summary, url FROM gyagus ORDER BY id DESC').all<Omit<GyaguRow, 'likes'>>();
	const items = results.map((g) => {
		// summary は前フリなので、あるときはタイトルに前フリ、本文にオチを入れる
		const title = g.summary || g.text;
		const lines = [`<title>${escapeXml(title)}</title>`];
		lines.push(`<link>${SITE_URL}#gag-${g.id}</link>`);
		lines.push(`<guid isPermaLink="false">urusaito-${g.id}</guid>`);
		lines.push(`<description>${escapeXml(g.summary ? g.text : (g.url ?? ''))}</description>`);
		if (g.url) lines.push(`<source url="${escapeXml(g.url)}">出典</source>`);
		return `<item>${lines.join('')}</item>`;
	});

	const xml = `<?xml version="1.0" encoding="UTF-8"?>`
		+ `<rss version="2.0"><channel>`
		+ `<title>ギャグ | るちーかのサイト</title>`
		+ `<link>${SITE_URL}</link>`
		+ `<description>このサイト、うるさいとｗｗｗ</description>`
		+ `<language>ja</language>`
		+ items.join('')
		+ `</channel></rss>`;

	return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
});

/**
 * だじゃれを新規追加する。
 * ペイロード: `{ text: string; summary?: string | null; url: string }`。
 */
app.post('/', requireApiKey, async (c) => {
	const body = await c.req.json<unknown>().catch(() => null);
	if (body == null || typeof body !== 'object') {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}

	const { text, summary, url } = body as Record<string, unknown>;
	if (typeof text !== 'string' || text === '') {
		return c.json({ error: 'text must be a non-empty string' }, 400);
	}
	if (summary != null && typeof summary !== 'string') {
		return c.json({ error: 'summary must be a string or null' }, 400);
	}
	if (typeof url !== 'string' || !URL.canParse(url)) {
		return c.json({ error: 'url must be a valid URL' }, 400);
	}

	const row = await c.env.DB.prepare('INSERT INTO gyagus (text, summary, url) VALUES (?, ?, ?) RETURNING id, text, summary, url, likes')
		.bind(text, summary || null, url)
		.first<GyaguRow>();
	return c.json(row, 201);
});

/**
 * だじゃれにいいねする。連打は気持ちの強さとして許容するが、IP 単位でレート制限をかける。
 * 戻り値: `{ id: number; likes: number }`。
 */
app.post('/like/:id', async (c) => {
	const id = Number(c.req.param('id'));
	if (!Number.isInteger(id)) {
		return c.json({ error: 'id must be an integer' }, 400);
	}

	const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
	const { success } = await c.env.LIKE_LIMITER.limit({ key: ip });
	if (!success) {
		return c.json({ error: 'Too many likes' }, 429);
	}

	const row = await c.env.DB.prepare('UPDATE gyagus SET likes = likes + 1 WHERE id = ? RETURNING id, likes')
		.bind(id)
		.first<Pick<GyaguRow, 'id' | 'likes'>>();
	if (row == null) {
		return c.json({ error: 'Not found' }, 404);
	}
	return c.json(row);
});

export default app;
