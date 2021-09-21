import { Lokinet } from './lokinet.js';
import fetch from 'node-fetch';
import { get } from 'http';

const runit = async () => {

  let ctx = new Lokinet();

  await ctx.start();
  const host = await ctx.hostname();
  console.log(`we are ${host}`);

  // make an http agent
  const agent = ctx.agent();

  // do a get request
  const req = get({
    hostname: "dw68y1xhptqbhcm5s8aaaip6dbopykagig5q5u1za4c7pzxto77y.loki",
    path: "/",
    agent: agent
  });
  req.on('response', (resp) => {
    resp.on("data", (data) => {
      console.log("got data");
      console.log(data.toString());
    });
    resp.on("end", () => {
      ctx.stop();
    });
  });
  req.end();
};

await runit();
