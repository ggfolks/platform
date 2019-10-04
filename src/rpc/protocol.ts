import {log} from "../core/util"
import {Encoder, Decoder} from "../core/codec"
import {Auth} from "../auth/auth"
import {MethodMeta} from "./meta"

const DebugLog = false

export const enum RpcType { CALL, REQ, RVAL, RERR }
export type RpcMsg = {type :RpcType.CALL, index :number, args :any[]}
                   | {type :RpcType.REQ,  index :number, id :number, args :any[]}
                   | {type :RpcType.RVAL, index :number, id :number, rval :any}
                   | {type :RpcType.RERR, index :number, id :number, cause :string}

export function makeCodec (metas :MethodMeta[]) {
  return {
    encode (enc :Encoder, rcpt :Auth, msg :RpcMsg) :void {
      if (DebugLog) log.debug("encodeRpc", "msg", msg)
      enc.addValue(msg.type, "size8")
      const meta = metas[msg.index]
      enc.addValue(msg.index, "size8")
      switch (msg.type) {
      case RpcType.CALL:
        for (let ii = 0; ii < msg.args.length; ii += 1) enc.addValue(msg.args[ii], meta.args[ii])
        break
      case RpcType.REQ:
        enc.addValue(msg.id, "size16")
        for (let ii = 0; ii < msg.args.length; ii += 1) enc.addValue(msg.args[ii], meta.args[ii])
        break
      case RpcType.RVAL:
        if (meta.type !== "req") throw new Error(
          log.format("Encoding rval for non-req service method?", "msg", msg))
        enc.addValue(msg.id, "size16")
        enc.addValue(msg.rval, meta.rval)
        break
      case RpcType.RERR:
        enc.addValue(msg.id, "size16")
        enc.addValue(msg.cause, "string")
        break
      }
    },
    decode (dec :Decoder) :RpcMsg {
      const type = dec.getValue("size8")
      const index = dec.getValue("size8")
      const meta = metas[index]
      if (DebugLog) log.debug("decodeRpc", "type", type, "meta", meta)
      switch (type) {
      case RpcType.CALL: return {type, index, args: meta.args.map(t => dec.getValue(t))}
      case RpcType.REQ: return {
          type, index, id: dec.getValue("size16"), args: meta.args.map(t => dec.getValue(t))}
      case RpcType.RVAL:
        if (meta.type !== "req") throw new Error(
          log.format("Decoding rval for non-req service method?", "index", index))
        return {type, index, id: dec.getValue("size16"), rval: dec.getValue(meta.rval)}
      case RpcType.RERR:
        return {type, index, id: dec.getValue("size16"), cause: dec.getValue("string")}
      default: throw new Error(`Unknown channel msg type '${type}'`)
      }
    }
  }
}
