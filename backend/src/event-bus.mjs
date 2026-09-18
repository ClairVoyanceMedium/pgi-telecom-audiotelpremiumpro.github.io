export class EventBus{
  #listeners=new Set();
  publish(type,payload){
    const event=Object.freeze({type,payload,at:new Date().toISOString()});
    for(const listener of this.#listeners){
      try{listener(event);}catch{}
    }
    return event;
  }
  subscribe(listener){
    this.#listeners.add(listener);
    return ()=>this.#listeners.delete(listener);
  }
  get size(){return this.#listeners.size;}
}
