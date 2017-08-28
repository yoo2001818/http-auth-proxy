'use strict';

const fs = require('fs');
const path = require('path');
const serveStatic = require('serve-static');
const auth = require('http-auth');
const bodyParser = require('body-parser');
const randToken = require('rand-token');
const request = require('request');
const app = require('express')();

const configPath = process.env.CONFIG_PATH || './config';
const storagePath = process.env.STORAGE_PATH || './storage/urls.json';

const config = require(configPath);
let storage = {};
let localCache = {};

// Load only happens for the first time.
function load() {
  try {
    storage = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
  } catch (e) {
    storage = {};
  }
  return storage;
}

load();

function save(storage, callback) {
  fs.writeFile(storagePath, JSON.stringify(storage), callback);
}

const authBasic = auth.basic({
  realm: 'http-auth-proxy admin mode',
}, (username, password, callback) => {
  callback(config.auth.some((v) => v[0] === username && v[1] === password));
});

const authMiddleware = auth.connect(authBasic);

app.use(bodyParser.urlencoded({ extended: false }));

app.post('/', authMiddleware, (req, res) => {
  const { url, username, password, bearer, expiry } = req.body;
  let headers = {};
  req.body.headers.split(/[\r\n]+/g).forEach(line => {
    let result = /^([^: ]+)\s*:\s*(.+)$/.exec(line);
    if (result == null) return;
    headers[result[1]] = result[2];
  });
  const id = randToken.generate(16);
  const doAuth = !!username;
  const doBearer = !!bearer;
  storage[id] = {
    id,
    url,
    doAuth, doBearer,
    auth: doAuth ? { username, password } : { bearer },
    expiry: parseInt(expiry),
  };
  save(storage, (err) => {
    if (err) res.sendStatus(500);
    else res.send(config.url + id);
  });
});

app.all('/:urlId', (req, res, next) => {
  const id = req.params.urlId;
  if (storage[id] == null) return next();
  let cache = localCache[id] || { fetchAt: 0, body: '', mime: '' };
  const entry = storage[id];
  if (Date.now() <= cache.fetchAt) {
    res.type(cache.mime);
    res.send(cache.body);
  }
  // Fetch data...
  request(entry.url, {
    auth: (entry.doAuth || entry.doBearer) ? entry.auth : undefined,
  }, (err, response, body) => {
    if (err) {
      console.log(err.stack);
      return res.send('An error has been occurred.');
    }
    if (response.statusCode >= 400) {
      return res.send(`Server returned code ${response.statusCode}`);
    }
    // Update data.
    cache = localCache[id] = {
      fetchAt: Date.now() + entry.expiry * 1000,
      body,
      mime: response.headers['content-type'],
    };
    res.type(cache.mime);
    res.send(cache.body);
  });
});

app.use(serveStatic(path.resolve(__dirname, 'public')));

app.listen(config.port, config.host, () => {
  console.log(`Listening on ${config.host}:${config.port}`);
});
