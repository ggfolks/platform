import {PMap} from "../core/util"
import {Emitter, Value} from "../core/react"
import {setTextCodec} from "../core/codec"
import {SessionAuth, guestValidator} from "../auth/auth"
import {CState, ChannelHandler, ChannelManager, Connection} from "./channel"
import {ChannelClient} from "./client"

import {TextEncoder, TextDecoder} from "util"
setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

export class RunQueue {
  private readonly ops :Array<() => void> = []

  push (op :() => void) { this.ops.push(op) }

  process (onDone :() => void) {
    if (this.ops.length > 0) {
      this.ops.shift()!()
      setTimeout(() => this.process(onDone), 1)
    }
    else onDone()
  }
}

const testAddr = new URL("ws://test/")

export class TestSession implements Connection {
  readonly cmgr :ChannelManager
  readonly state = Value.constant<CState>("open")
  readonly msgs = new Emitter<Uint8Array>()

  constructor (readonly client :TestClient, handlers :PMap<ChannelHandler<any>>) {
    this.cmgr = new ChannelManager(this, handlers, {guest: guestValidator})
  }

  send (msg :Uint8Array) :boolean {
    this.client.recv(msg)
    return true
  }

  toString () { return "TestSession" }
}

export class TestClient extends ChannelClient {
  readonly session :TestSession

  constructor (auth :SessionAuth, readonly runq :RunQueue, handlers :PMap<ChannelHandler<any>>) {
    super({serverUrl: testAddr, auth: Value.constant(auth)})
    this.session = new TestSession(this, handlers)
    this.state.update("open")
  }

  recv (msg :Uint8Array) {
    const cmsg = msg.slice()
    this.runq.push(() => this.msgs.emit(cmsg))
  }

  protected openSocket (url :URL) {
    return {
      send: (msg :Uint8Array) => {
        const cmsg = msg.slice()
        this.runq.push(() => this.session.msgs.emit(cmsg))
      },
      close: () => {},
      toString: () => "TestSocket"
    }
  }
}

// we have to have a test in here otherwise jest freaks out
test("noop", () => {
  expect("noop").toBe("noop")
})
