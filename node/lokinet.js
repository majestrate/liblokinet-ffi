/** lokinet.js -- glue jizz for liblokinet native shit */

import bindings from 'bindings';
import fetch from 'node-fetch';

import { readFile } from 'fs/promises';

import { connect } from 'net';


const lokinet = bindings('liblokinet_js');

const make_buffer = (str) => {
  let arr = Array.from(str, (e) => e.charCodeAt(0) );
  return new Uint8Array(arr).buffer;
};

const runit = async () => {

  let ctx = new lokinet.Context();

  console.log("getting bootstrap...");
  // const resp = await fetch('https://seed.lokinet.org/lokinet.signed');
  // const rc = make_buffer(await resp.text());
  const data = await readFile('bootstrap.signed');
  const rc = new Uint8Array(data).buffer;

  ctx.bootstrap(rc);
  console.log("bootstrapped");
  ctx.start();
  console.log("Started as " + ctx.addr());

  const stream_info = ctx.outbound_stream("dw68y1xhptqbhcm5s8aaaip6dbopykagig5q5u1za4c7pzxto77y.loki:80");
  console.log(`got stream info: ${stream_info.port}`);


  const end = () => {
    ctx.close_stream(stream_info.id);
    ctx.stop();
    console.log("stopped");
  };


  const conn = connect(stream_info.port, stream_info.host, () => {
    console.log("sending request");
    conn.write('GET / HTTP/1.1\r\nHost: probably.loki\r\n\r\n');
  });
  conn.on('data', (data) => {
    console.log(data.toString());
    conn.end();
  });
  conn.on('error', (err) => {
    console.log(`connection error: ${err}`);
    conn.end();
  });
  conn.on('end', () => {
    end();
  });

};


await runit();
