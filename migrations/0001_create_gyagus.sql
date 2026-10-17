-- クソギャグテーブル summary は前フリで、存在するときtextを畳んでおく想定
CREATE TABLE gyagus (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	text TEXT NOT NULL,
	summary TEXT,
	url TEXT
);
