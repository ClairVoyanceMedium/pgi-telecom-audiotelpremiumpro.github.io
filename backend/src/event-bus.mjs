import {randomUUID} from "node:crypto";

const DEFAULT_CHANNEL="pgi_realtime_v1";
const MAX_NOTIFY_BYTES=7000;

export class EventBus{
  #listeners=new Set();
  #nodeId=randomUUID();
  #relaySql=null;
  #relayChannel=DEFAULT_CHANNEL;
  #relayHandle=null;
  #relayListening=false;
  #relayPublished=0;
  #relayReceived=0;
  #relayErrors=0;

  publish(type,payload){
    const event=Object.freeze({
      id:randomUUID(),
      type:normalizeEventType(type),
      payload:payload??null,
      at:new Date().toISOString()
    });
    this.#emit(event);
    this.#publishRelay(event);
    return event;
  }

  subscribe(listener){
    if(typeof listener!=="function")throw new TypeError("event listener must be a function");
    this.#listeners.add(listener);
    return ()=>this.#listeners.delete(listener);
  }

  async attachPostgres(sql,{channel=DEFAULT_CHANNEL,listen=true}={}){
    if(!sql||typeof sql.notify!=="function")throw new TypeError("PostgreSQL relay requires sql.notify()");
    if(this.#relaySql)throw new Error("PostgreSQL relay already attached");
    this.#relayChannel=normalizeChannel(channel);
    this.#relaySql=sql;

    if(listen){
      if(typeof sql.listen!=="function"){
        this.#relaySql=null;
        throw new TypeError("PostgreSQL relay listener requires sql.listen()");
      }
      try{
        this.#relayHandle=await sql.listen(this.#relayChannel,payload=>this.#receiveRelay(payload));
        this.#relayListening=true;
      }catch(error){
        this.#relaySql=null;
        this.#relayHandle=null;
        this.#relayListening=false;
        throw error;
      }
    }
    return this.relayStatus;
  }

  async close(){
    const handle=this.#relayHandle;
    this.#relayHandle=null;
    this.#relayListening=false;
    this.#relaySql=null;
    if(handle&&typeof handle.unlisten==="function"){
      try{await handle.unlisten();}catch{this.#relayErrors++;}
    }
  }

  get size(){return this.#listeners.size;}

  get relayStatus(){
    return Object.freeze({
      attached:Boolean(this.#relaySql),
      listening:this.#relayListening,
      channel:this.#relayChannel,
      published:this.#relayPublished,
      received:this.#relayReceived,
      errors:this.#relayErrors
    });
  }

  #emit(event){
    for(const listener of this.#listeners){
      try{listener(event);}catch{}
    }
  }

  #publishRelay(event){
    const sql=this.#relaySql;
    if(!sql)return;

    let payload;
    try{
      payload=JSON.stringify({source:this.#nodeId,event});
      if(Buffer.byteLength(payload,"utf8")>MAX_NOTIFY_BYTES){
        this.#relayErrors++;
        return;
      }
    }catch{
      this.#relayErrors++;
      return;
    }

    Promise.resolve(sql.notify(this.#relayChannel,payload))
      .then(()=>{this.#relayPublished++;})
      .catch(()=>{this.#relayErrors++;});
  }

  #receiveRelay(raw){
    try{
      const message=JSON.parse(String(raw||""));
      if(!message||message.source===this.#nodeId)return;
      const incoming=message.event;
      if(!incoming||typeof incoming!=="object")throw new Error("invalid relay event");
      const event=Object.freeze({
        id:typeof incoming.id==="string"&&incoming.id?incoming.id:randomUUID(),
        type:normalizeEventType(incoming.type),
        payload:incoming.payload??null,
        at:validIsoDate(incoming.at)?incoming.at:new Date().toISOString()
      });
      this.#relayReceived++;
      this.#emit(event);
    }catch{
      this.#relayErrors++;
    }
  }
}

function normalizeEventType(value){
  const type=String(value||"").trim();
  if(!/^[A-Za-z0-9._:-]{1,80}$/.test(type))throw new TypeError("invalid event type");
  return type;
}

function normalizeChannel(value){
  const channel=String(value||"").trim();
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(channel))throw new TypeError("invalid PostgreSQL relay channel");
  return channel;
}

function validIsoDate(value){
  return typeof value==="string"&&Number.isFinite(Date.parse(value));
}
