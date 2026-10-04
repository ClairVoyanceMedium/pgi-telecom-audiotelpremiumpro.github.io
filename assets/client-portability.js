import {createController as base} from "./client-portability-base.js";
export function createController(options){
  const controller=base(options);
  import("./client-portability-priority.js").then(m=>m.init(options)).catch(()=>{});
  return controller;
}
