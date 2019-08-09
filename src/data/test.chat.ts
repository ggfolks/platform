import {Timestamp} from "../core/util"
import {Mutable, Subject, Value} from "../core/react"
import {Record} from "../core/data"
import {Encoder, Decoder, setTextCodec} from "../core/codec"
import {getPropMetas, dobject, dmap, dvalue, dcollection, dqueue} from "./meta"
import {Auth, ID, DataSource, DObject, DObjectStatus, DObjectType, DQueueAddr, MetaMsg,
        Path, Subscriber, findObjectType} from "./data"
import {DownMsg, DownType, SyncMsg, UpType, encodeDown, decodeUp,
        addObject, getObject} from "./protocol"
import {Address, Client, Connection} from "./client"

import {TextEncoder, TextDecoder} from "util"
setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

//
// User object: maintains info on a user

@dobject
export class UserObject extends DObject {

  @dvalue("string")
  username = this.value("")

  @dvalue("timestamp")
  lastLogin = this.value(0)

  @dqueue(handleUserReq)
  userq = this.queue<UserReq>()

  canSubscribe (auth :Auth) { return auth.id === this.key || super.canSubscribe(auth) }
  canWrite (prop :string, who :Auth) { return (prop === "username") || super.canWrite(prop, who) }
}

type UserReq = {type: "sendUsername", queue :DQueueAddr}

function handleUserReq (obj :UserObject, req :UserReq, auth :Auth) {
  switch (req.type) {
  case "sendUsername":
    const rsp = {type: "setUsername", id: obj.key, username: obj.username.current}
    obj.source.post(req.queue, rsp)
    break
  }
}

//
// Room object: handles data for a single chat room

type MID = number

type RoomReq = {type: "speak", text :string} |
               {type: "edit", mid :MID, newText :string} |
               {type: "addOccupant", id :ID} |
               {type: "setUsername", id :ID, username :string}

interface Message {
  sender :ID
  sent :Timestamp
  text :string
  edited? :Timestamp
}

interface OccupantInfo {
  username :string
}

@dobject
export class RoomObject extends DObject {

  @dvalue("string")
  name = this.value("")

  @dmap("id", "record")
  occupants = this.map<ID, OccupantInfo>()

  @dvalue("int32")
  nextMsgId = this.value(1)

  @dmap("int32", "record")
  messages = this.map<MID, Message>()

  @dqueue(handleRoomReq)
  roomq = this.queue<RoomReq>()

  @dqueue(handleMetaMsg)
  metaq = this.queue<MetaMsg>()

  canSubscribe (auth :Auth) { return this.occupants.has(auth.id) || super.canSubscribe(auth) }
}

function handleRoomReq (obj :RoomObject, req :RoomReq, auth :Auth) {
  switch (req.type) {
  case "speak":
    if (obj.occupants.has(auth.id) || auth.isSystem) {
      const mid = obj.nextMsgId.current
      obj.nextMsgId.update(mid+1)
      obj.messages.set(mid, {sender: auth.id, sent: Timestamp.now(), text: req.text})
    }
    break

  case "edit":
    const msg = obj.messages.get(req.mid)
    if (msg && msg.sender === auth.id) {
      obj.messages.set(req.mid, {...msg, text: req.newText, edited: Timestamp.now()})
    }
    break

  case "addOccupant":
    if (auth.isSystem) {
      obj.occupants.set(req.id, {username: "?"})
    }
    break

  case "setUsername":
    if (auth.isSystem) {
      const info = obj.occupants.get(req.id)
      if (info) obj.occupants.set(req.id, {...info, username: req.username})
    }
    break
  }
}

function handleMetaMsg (obj :RoomObject, msg :MetaMsg, auth :Auth) {
  switch (msg.type) {
  case "subscribed":
    obj.occupants.set(msg.userId, {username: "?"})
    const req = {type: "sendUsername", path: obj.roomq.addr}
    obj.source.post(UserObject.queueAddr(["users", msg.userId], "userq"), req)
    break
  case "unsubscribed":
    obj.occupants.delete(msg.userId)
    break
  }
}

//
// Root object: manages chat rooms

type ChatReq = {type :"create" , name :string}
             | {type :"join", id :ID}
             | {type :"delete", id :ID}

interface RoomInfo {
  name :string
  occupants :number
}

@dobject
export class RootObject extends DObject {

  canSubscribe (auth :Auth) { return true }

  @dmap("id", "record")
  publicRooms = this.map<ID, RoomInfo>()

  @dcollection("string", UserObject)
  users = this.collection<ID, UserObject>()

  @dcollection("string", RoomObject)
  rooms = this.collection<ID, RoomObject>()

  @dqueue(handleChatReq)
  chatq = this.queue<ChatReq>()
}

function handleChatReq (obj :RootObject, req :ChatReq, auth :Auth) {
  switch (req.type) {
  case "create":
    // TODO
    break
  case "join":
    // TODO
    break
  case "delete":
    // TODO
    break
  }
}

class TestDataSource implements DataSource {
  nextOid = 1
  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :T {
    const oid = this.nextOid
    this.nextOid = oid+1
    return new otype(this, Value.constant({state: "resolved"} as DObjectStatus), path, oid)
  }
  post<M> (queue :DQueueAddr, msg :M) {} // noop!
  sendSync (obj :DObject, msg :SyncMsg) {} // noop!
}

test("metas", () => {
  const rmetas = getPropMetas(RootObject.prototype)
  expect(rmetas[0]).toEqual({type: "map", name: "publicRooms", index: 0,
                             ktype: "id", vtype: "record"})
  expect(rmetas[1]).toEqual({type: "collection", name: "users", index: 1,
                             ktype: "string", otype: UserObject})
  expect(rmetas[3]).toEqual({type: "queue", name: "chatq", index: 3, handler: handleChatReq})

  const umetas = getPropMetas(UserObject.prototype)
  expect(umetas[0]).toEqual({type: "value", name: "username", index: 0, vtype: "string"})
  expect(umetas[1]).toEqual({type: "value", name: "lastLogin", index: 1, vtype: "timestamp"})
})

test("access", () => {
  const source = new TestDataSource()
  const user = source.resolve(["users", "1"], UserObject)
  expect(user.key).toEqual("1")

  const auth1 = {id: "1", isSystem: false}
  const auth2 = {id: "2", isSystem: false}
  const auths = {id: "system", isSystem: true}

  expect(user.canSubscribe(auth1)).toEqual(true)
  expect(user.canSubscribe(auth2)).toEqual(false)

  expect(user.canWrite("username", auth1)).toEqual(true)
  expect(user.canWrite("username", auths)).toEqual(true)

  expect(user.canWrite("lastLogin", auth1)).toEqual(false)
  expect(user.canWrite("lastLogin", auths)).toEqual(true)
})

test("codec", () => {
  const source = new TestDataSource()
  const path = ["rooms", "1"]
  const room = source.resolve(path, RoomObject)
  room.name.update("Test room")
  room.occupants.set("1", {username: "Testy Testerson"})
  room.occupants.set("2", {username: "Sandy Clause"})
  room.nextMsgId.update(4)
  const now = Timestamp.now()
  room.messages.set(1, {sender: "1", sent: now-5*60*1000, text: "Yo Sandy!"})
  room.messages.set(2, {sender: "2", sent: now-3*60*1000, text: "Hiya Testy."})
  room.messages.set(3, {sender: "1", sent: now-1*60*1000, text: "How's the elves?"})

  const auth = {id: "0", isSystem: true}
  const enc = new Encoder()
  addObject(auth, room, enc)

  const msg = enc.finish()
  const dec = new Decoder(msg)
  const droom = getObject<RoomObject>(dec, source.resolve(path, RoomObject))

  expect(droom.name.current).toEqual(room.name.current)
  expect(Array.from(droom.occupants)).toEqual(Array.from(room.occupants))
  expect(droom.nextMsgId.current).toEqual(room.nextMsgId.current)
  expect(Array.from(droom.messages)).toEqual(Array.from(room.messages))
})

class CObject extends DObject {
  @dvalue("string")
  name = this.value("C")
}
class BObject extends DObject {
  @dcollection("string", CObject)
  cs = this.collection<ID, CObject>()
}
class AObject extends DObject {
  @dcollection("string", BObject)
  bs = this.collection<ID, BObject>()
  @dcollection("string", CObject)
  cs = this.collection<ID, CObject>()
}

test("findObjectType", () => {
  expect(findObjectType(RootObject, [])).toStrictEqual(RootObject)
  expect(findObjectType(RootObject, ["rooms", "1"])).toStrictEqual(RoomObject)
  expect(findObjectType(RootObject, ["users", "1"])).toStrictEqual(UserObject)
  expect(findObjectType(AObject, ["cs", "1"])).toStrictEqual(CObject)
  expect(findObjectType(AObject, ["bs", "1", "cs", "1"])).toStrictEqual(CObject)
})

class TestServer<R extends DObject> implements DataSource {
  private readonly objects = new Map<string, DObject>()
  private auth :Auth = {id: "0", isSystem: true}

  constructor (readonly rtype :DObjectType<R>) {}

  connect (conn :Connection, id :ID) :ClientHandler {
    return new ClientHandler(this, conn, id)
  }

  resolve<T extends DObject> (path :Path, otype? :DObjectType<T>) :T {
    const key = path.join(":")
    const obj = this.objects.get(key)
    if (obj) return obj as T

    const ctor = otype || findObjectType(this.rtype, path)
    // normally this would be pending until we loaded its persistent data, but we don't support
    // persistent data yet, simple!
    const status = Mutable.local({state: "resolved"} as DObjectStatus)
    const nobj = new ctor(this, status, path, 0)
    this.objects.set(key, nobj)
    return nobj
  }

  post (queue :DQueueAddr, msg :Record, auth? :Auth) :void {
    const obj = this.resolve<DObject>(queue.path, findObjectType(this.rtype, queue.path))
    obj.status.whenOnce(s => s.state === "resolved", s => {
      const meta = obj.metas[queue.index]
      if (meta.type === "queue") meta.handler(obj, msg, auth || this.auth)
      else console.warn(`Dropping post to invalid queue address ` +
                        `[obj=${obj}, queue=${queue}, msg=${msg}]`)
    })
  }

  sendSync (obj :DObject, msg :SyncMsg) :void {
    // nothing to do here, this would only be used if we were proxying the object from some other
    // server, but we're the source of truth for `obj`
  }
}

interface Subscription extends Subscriber {
  obj :DObject
}

class ClientHandler {
  private readonly subscrips = new Map<number, Subscription>()
  private readonly encoder = new Encoder()
  private readonly resolver = (oid :number) => {
    const sub = this.subscrips.get(oid)
    return sub && sub.obj
  }

  readonly auth :Auth

  constructor (readonly server :TestServer<any>, readonly conn :Connection, readonly id :ID) {
    this.auth = {id, isSystem: false}
  }

  handleMsg (msgData :Uint8Array) {
    const msg = decodeUp(this.resolver, new Decoder(msgData))
    switch (msg.type) {
    case UpType.SUB:
      const obj = this.server.resolve(msg.path)
      obj.status.whenOnce(s => s.state === "resolved", s => {
        const sub = {obj, auth: this.auth, sendSync: (msg :SyncMsg) => this.sendDown({...msg, oid})}
        if (obj.subscribe(sub)) {
          this.subscrips.set(msg.oid, sub)
          this.sendDown({type: DownType.SUBOBJ, oid: msg.oid, obj})
        }
        else this.sendDown({type: DownType.SUBERR, oid: msg.oid, cause: "Access denied."})
      })
      break

    case UpType.UNSUB:
      const sub = this.subscrips.get(msg.oid)
      if (sub) {
        sub.obj.unsubscribe(sub)
        this.subscrips.delete(msg.oid)
      }
      break

    case UpType.POST:
      this.server.post(msg.queue, msg.msg, this.auth)
      break

    default:
      const oid = msg.oid
      const ssub = this.subscrips.get(oid)
      if (ssub) ssub.obj.applyWrite(msg, this.auth)
      else console.warn(`Dropping sync message, no subscription [msg=${JSON.stringify(msg)}]`)
    }
  }

  sendSync (obj :DObject, msg :SyncMsg) {
    throw new Error("TODO")
  }

  sendDown (msg :DownMsg) {
    try {
      encodeDown(this.auth, msg, this.encoder)
      this.conn.client.recvMsg(this.encoder.finish())
    } catch (err) {
      this.encoder.reset()
      console.warn(`Failed to encode [msg=${JSON.stringify(msg)}]`)
      console.warn(err)
    }
  }

  dispose () {
    // TODO: unsub from all objects
  }
}

class TestConnection extends Connection {
  private readonly handler :ClientHandler

  constructor (client :Client, addr :Address, server :TestServer<any>, id :ID) {
    super(client, addr)
    this.handler = server.connect(this, id)
  }

  sendMsg (msg :Uint8Array) { this.handler.handleMsg(msg) }
  dispose () { this.handler.dispose() }
  protected connect (addr :Address) {} // nothing
}

test("client-server", () => {
  const testAddr = {host: "test", port: 0, path: "/"}
  const testLocator = (path :Path) => Subject.constant(testAddr)
  const testServer = new TestServer(RootObject)

  const clientA = new Client(testLocator, (c, a) => new TestConnection(c, a, testServer, "a"))
  // const clientB = new Client(testLocator, (c, a) => new TestConnection(c, a, testServer, "b"))

  const rootA = clientA.resolve([], RootObject)
  rootA.status.onValue(s => console.log(s))

  const userAA = clientA.resolve(["users", "a"], UserObject)
  userAA.username.update("User A")
  userAA.username.onValue(username => expect(username).toEqual("User A"))

  // try to subscribe to user b's object via a, should fail
  const userAB = clientA.resolve(["users", "b"], UserObject)
  userAB.status.onValue(s => console.log(JSON.stringify(s)))
  userAB.status.onValue(s => expect(s.state === "error"))
})
