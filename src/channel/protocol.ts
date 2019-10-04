import {log} from "../core/util"
import {UUID} from "../core/uuid"
import {Path} from "../core/path"
import {Encoder, Decoder} from "../core/codec"
import {Auth} from "../auth/auth"

const DebugLog = false

export const enum ChanType { AUTH, AUTHED, OPEN, READY, FAILED, CLOSE }
export type ChanMsg = {type :ChanType.AUTH, source :string, id :UUID, token :string}
                    | {type :ChanType.AUTHED, id :UUID}
                    | {type :ChanType.OPEN,   id :number, ctype :string, cpath :Path}
                    | {type :ChanType.READY,  id :number, remoteId :number}
                    | {type :ChanType.FAILED, id :number, cause :string}
                    | {type :ChanType.CLOSE,  id :number}

export function encodeMsg (enc :Encoder, rcpt :Auth, msg :ChanMsg) :void {
  if (DebugLog) log.debug("encodeMsg", "msg", msg)
  enc.addValue(msg.type, "int8")
  switch (msg.type) {
  case ChanType.AUTH:
    enc.addValue(msg.source, "string")
    enc.addValue(msg.id, "uuid")
    enc.addValue(msg.token, "string")
    break
  case ChanType.AUTHED:
    enc.addValue(msg.id, "uuid")
    break
  case ChanType.OPEN:
    enc.addValue(msg.id, "size16")
    enc.addValue(msg.ctype, "string")
    enc.addPath(msg.cpath)
    break
  case ChanType.READY:
    enc.addValue(msg.id, "size16")
    enc.addValue(msg.remoteId, "size16")
    break
  case ChanType.FAILED:
    enc.addValue(msg.id, "size16")
    enc.addValue(msg.cause, "string")
    break
  case ChanType.CLOSE:
    enc.addValue(msg.id, "size16")
    break
  }
}

export function decodeMsg (dec :Decoder) :ChanMsg {
  const type = dec.getValue("int8")
  if (DebugLog) log.debug("decodeMsg", "type", type)
  switch (type) {
  case ChanType.AUTH:
    return {
      type, source :dec.getValue("string"), id: dec.getValue("uuid"), token: dec.getValue("string")
    }
  case ChanType.AUTHED:
    return {type, id: dec.getValue("uuid")}
  case ChanType.OPEN:
    return {type, id: dec.getValue("size16"), ctype: dec.getValue("string"), cpath: dec.getPath()}
  case ChanType.READY:
    return {type, id: dec.getValue("size16"), remoteId: dec.getValue("size16")}
  case ChanType.FAILED:
    return {type, id: dec.getValue("size16"), cause: dec.getValue("string")}
  case ChanType.CLOSE:
    return {type, id: dec.getValue("size16")}
  default: throw new Error(`Unknown channel msg type '${type}'`)
  }
}
