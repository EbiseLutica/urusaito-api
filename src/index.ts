import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
	DB: D1Database;
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
 * だじゃれ一覧を新しい順に返す。
 * 互換性のため、summary 無しは本文文字列、summary 有りは [summary, text] のタプルで返す。
 */
app.get('/', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT id, text, summary, url FROM gyagus ORDER BY id DESC').all<GyaguRow>();
	return c.json(results.map((g) => (g.summary == null ? g.text : [g.summary, g.text])));
});

export default app;
