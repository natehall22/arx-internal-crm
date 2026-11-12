// supabase-js talks to <url>/rest/v1/...; PostgREST serves from /. This strips the prefix. Usage: node rest-prefix-proxy.js <listenPort> <postgrestPort>
const http = require('http')
const [listen, target] = [Number(process.argv[2]), Number(process.argv[3])]
http.createServer((req, res) => {
  const p = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url.replace(/^\/rest\/v1/, ''), headers: req.headers }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers); r.pipe(res)
  })
  p.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
  req.pipe(p)
}).listen(listen, '127.0.0.1')
