import {Disposable, PMap, log} from "../core/util"
import {Path} from "../core/path"
import {Value} from "../core/react"
import {Auth} from "../auth/auth"
import {CState, Channel, ChannelCodec, ChannelHandler, ChannelManager} from "../channel/channel"
import {getMethodMetas} from "./meta"
import {RpcType, RpcMsg, makeCodec} from "./protocol"

/** The base class for service protocols. A protocol definition must extend this class and define
  * stub methods for all of the RPC service methods. This will provide the metadata and (via some
  * TypeScript type system magic) the type of the service that is implemented (on the server) and
  * proxied (on the client). */
export abstract class RProtocol {

  protected stub () :never { throw new Error("stub") }
}

/** The type of a protocol "constructor". */
export type RProtocolType<P extends RProtocol> = {new () :P}

type FunProps<T> = {[K in keyof T] :T[K] extends Function ? K : never}[keyof T]

/** Defines lifecycle additions that are provided to a service proxy. */
export interface RService extends Disposable {

  /** The state of the channel that underlies this service. When the state transitions to `closed`
    * the service is no longer available. */
  state :Value<CState>

  /** Disposes this service. This can be called on the client or server and will shutdown the
    * underlying channel. */
  dispose () :void
}

/** Defines the interface for an implementation based on protocol `P`. */
export type ImplOf<P extends RProtocol> = Pick<P, FunProps<P>>

/** Defines the interface of the proxy of the service defined by protocol `P`. */
export type ProxyOf<P extends RProtocol> = Pick<P, FunProps<P>> & RService

const MAX_PENDING_REQS = 1024

/** Resolves service implementations for a given `protocol` based on a `path` and `auth` information
  * for the requester of the service. */
export interface ServiceProvider<P extends RProtocol> {

  /** The protocol for the provided service. */
  protocol :RProtocolType<P>

  /** Attempts to open a service at `path` for the client identified by `auth`.
    * @return `undefined` if this provider does not handle services at `path`, or a promise which
    * yields a service implementation or a rejection (due to failed authentication for example). */
  open (auth :Auth, path :Path) :Promise<ImplOf<P>>|undefined
}

function tryOpen<P extends RProtocol> (
  prov :ServiceProvider<P>, auth :Auth, path :Path,
  mkChannel :(codec :ChannelCodec<RpcMsg>) => Channel<RpcMsg>
) :Promise<Channel<RpcMsg>>|undefined {
  const res = prov.open(auth, path)
  if (res) return res.then(svc => {
    const metas = getMethodMetas(prov.protocol.prototype)
    const channel = mkChannel(makeCodec(metas))
    channel.messages.onEmit(msg => {
      switch (msg.type) {
      case RpcType.CALL:
        const cmeta = metas[msg.index]
        if (cmeta && cmeta.type === "call") svc[cmeta.name](...msg.args)
        else log.warn("Invalid rpc call", "channel", channel, "msg", msg, "meta", cmeta)
        break

      case RpcType.REQ:
        const {id, index} = msg, rmeta = metas[index]
        if (rmeta && rmeta.type === "req") (svc[rmeta.name](...msg.args) as Promise<any>).then(
          res => channel.sendMsg({type: RpcType.RVAL, index, id, rval: res}),
          err => channel.sendMsg({type: RpcType.RERR, index, id, cause: err.message})
        )
        else {
          log.warn("Invalid rpc req", "channel", channel, "msg", msg, "meta", rmeta)
          channel.sendMsg({type: RpcType.RERR, index: msg.index, id: msg.id,
          cause: "Invalid req"})
        }
        break

      case RpcType.RVAL:
      case RpcType.RERR:
        log.warn("Unexpected rval/rerr on server end of channel", "msg", msg)
        break
      }
    })
    return channel
  })
  else return undefined
}

/** Creates a channel handler RPC services which resolves services via the supplied list of
  * `providers`. The handler can be registered with a [[ChannelManager]], and then clients (on the
  * other end of the channels) can resolve those services via [[resolveService]]. */
export function serviceHandler (providers :ServiceProvider<any>[]) :PMap<ChannelHandler<RpcMsg>> {
  return {
    service: (auth, path, mkChannel) => {
      for (const prov of providers) {
        const res = tryOpen(prov, auth.current, path, mkChannel)
        if (res) return res
      }
      return Promise.reject(new Error("Provider not found"))
    }
  }
}

/** Resolves a service at the specified `path` which is based on the specified `protocol`. The
  * `state` property of the returned service will transition to `open` when the service is ready for
  * operation (calls or requests made prior to that will be queued until the service is ready). If
  * the service fails to resolve, `state` will transition to `failed` (and a more detailed error
  * will have been logged by the channel system). */
export function resolveService<P extends RProtocol> (
  cmgr :ChannelManager, path :Path, protocol :RProtocolType<P>
) :ProxyOf<P> {
  const metas = getMethodMetas(protocol.prototype)
  const channel = cmgr.createChannel("service", path, makeCodec(metas))
  const pending = new Map<number, [(r:any) => void, (e:Error) => void]>()
  function getReqId () {
    for (let id = 1; id < MAX_PENDING_REQS; id += 1) if (!pending.has(id)) return id
    throw new Error(`Exceeded max pending RPC requests (${MAX_PENDING_REQS}`)
  }

  channel.messages.onEmit(msg => {
    switch (msg.type) {
    case RpcType.RVAL:
    case RpcType.RERR:
      const pend = pending.get(msg.id)
      if (!pend) log.warn("No pender for RPC result?", "msg", msg)
      else {
        pending.delete(msg.id)
        if (msg.type === RpcType.RVAL) pend[0](msg.rval)
        else pend[1](new Error(msg.cause))
      }
      break
    case RpcType.CALL:
    case RpcType.REQ:
      log.warn("Unexpected call/req on client end of channel", "msg", msg)
      break
    }
  })

  channel.state.when(s => s === "closed",
                     _ => pending.forEach(p => p[1](new Error("Service closed"))))

  const service = {
    state: channel.state,
    dispose: () => channel.dispose()
  } as ProxyOf<P>
  for (let ii = 0; ii < metas.length; ii += 1) {
    const {type, name} = metas[ii]
    switch (type) {
    case "req":
      service[name] = (...args :any[]) => {
        const id = getReqId()
        channel.sendMsg({type: RpcType.REQ,  index: ii, args, id})
        return new Promise<any>((resolve, reject) => pending.set(id, [resolve, reject]))
      }
      break

    case "call":
      service[name] = (...args :any[]) => {
        channel.sendMsg({type: RpcType.CALL, index: ii, args})
      }
      break
    }
  }
  return service
}
