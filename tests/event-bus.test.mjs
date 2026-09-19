import test from "node:test";
import assert from "node:assert/strict";
import {EventBus} from "../backend/src/event-bus.mjs";

class FakeSql{
  constructor(){
    this.listener=null;
    this.listenCalls=0;
    this.notifications=[];
    this.unlistened=false;
  }

  async listen(channel,listener){
    this.listenCalls++;
    this.channel=channel;
    this.listener=listener;
    return {
      unlisten:async()=>{
        this.unlistened=true;
        this.listener=null;
      }
    };
  }

  async notify(channel,payload){
    this.notifications.push({channel,payload});
    if(this.listener)this.listener(payload);
    return [];
  }

  remote(event){
    if(!this.listener)throw new Error("listener not attached");
    this.listener(JSON.stringify({source:"remote-node",event}));
  }
}

test("EventBus relays local events without duplicating PostgreSQL echo",async()=>{
  const bus=new EventBus();
  const sql=new FakeSql();
  const received=[];
  bus.subscribe(event=>received.push(event));

  await bus.attachPostgres(sql);
  const local=bus.publish("call.ingested",{id:42});
  await new Promise(resolve=>setImmediate(resolve));

  assert.equal(received.length,1);
  assert.equal(received[0].id,local.id);
  assert.equal(received[0].type,"call.ingested");
  assert.equal(sql.notifications.length,1);
  assert.equal(bus.relayStatus.published,1);
  assert.equal(bus.relayStatus.received,0);

  await bus.close();
  assert.equal(sql.unlistened,true);
  assert.equal(bus.relayStatus.attached,false);
});

test("EventBus accepts a remote PostgreSQL notification exactly once",async()=>{
  const bus=new EventBus();
  const sql=new FakeSql();
  const received=[];
  bus.subscribe(event=>received.push(event));
  await bus.attachPostgres(sql);

  sql.remote({
    id:"evt-remote-1",
    type:"carrier.switched",
    payload:{generation:7},
    at:"2026-09-19T12:00:00.000Z"
  });

  assert.deepEqual(received,[{
    id:"evt-remote-1",
    type:"carrier.switched",
    payload:{generation:7},
    at:"2026-09-19T12:00:00.000Z"
  }]);
  assert.equal(bus.relayStatus.received,1);
  await bus.close();
});

test("worker-only relay publishes without opening LISTEN connection",async()=>{
  const bus=new EventBus();
  const sql=new FakeSql();

  await bus.attachPostgres(sql,{listen:false});
  bus.publish("alert",{severity:"warn"});
  await new Promise(resolve=>setImmediate(resolve));

  assert.equal(sql.listenCalls,0);
  assert.equal(sql.notifications.length,1);
  assert.equal(bus.relayStatus.listening,false);
  await bus.close();
});

test("oversized relay payload stays local and is not sent to PostgreSQL",async()=>{
  const bus=new EventBus();
  const sql=new FakeSql();
  const received=[];
  bus.subscribe(event=>received.push(event));
  await bus.attachPostgres(sql,{listen:false});

  bus.publish("alert",{message:"x".repeat(8000)});

  assert.equal(received.length,1);
  assert.equal(sql.notifications.length,0);
  assert.equal(bus.relayStatus.errors,1);
  await bus.close();
});

test("invalid event names are rejected before publication",()=>{
  const bus=new EventBus();
  assert.throws(()=>bus.publish("bad event name",{}),/invalid event type/);
});
