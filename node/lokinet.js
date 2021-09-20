/** lokinet.js -- glue jizz for liblokinet native shit */

import bindings from 'bindings';
import fetch from 'node-fetch';

import { readFile } from 'fs/promises';

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
  ctx.stop();
  console.log("stopped");
};


await runit();
