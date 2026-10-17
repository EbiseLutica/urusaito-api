import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';
import { timingSafeEqual } from 'hono/utils/buffer';

type Bindings = {
	DB: D1Database;
	API_KEY: string;
};

type GyaguRow = {
	id: number;
	text: string;
	summary: string | null;
	url: string | null;
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

/**
 * だじゃれ一覧を新しい順に返す。
 * 互換性のため、summary 無しは本文文字列、summary 有りは [summary, text] のタプルで返す。
 */
app.get('/', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT id, text, summary, url FROM gyagus ORDER BY id DESC').all<GyaguRow>();
	return c.json(results.map((g) => (g.summary == null ? g.text : [g.summary, g.text])));
});

/**
 * だじゃれを新規追加する。
 * ペイロード: `{ text: string; cw?: string | null; url: string }`。cw は summary として保存する。
 */
app.post('/', requireApiKey, async (c) => {
	const body = await c.req.json<unknown>().catch(() => null);
	if (body == null || typeof body !== 'object') {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}

	const { text, cw, url } = body as Record<string, unknown>;
	if (typeof text !== 'string' || text === '') {
		return c.json({ error: 'text must be a non-empty string' }, 400);
	}
	if (cw != null && typeof cw !== 'string') {
		return c.json({ error: 'cw must be a string or null' }, 400);
	}
	if (typeof url !== 'string' || !URL.canParse(url)) {
		return c.json({ error: 'url must be a valid URL' }, 400);
	}

	const row = await c.env.DB.prepare('INSERT INTO gyagus (text, summary, url) VALUES (?, ?, ?) RETURNING id, text, summary, url')
		.bind(text, cw || null, url)
		.first<GyaguRow>();
	return c.json(row, 201);
});

export default app;
