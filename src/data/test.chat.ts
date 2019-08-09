import {Timestamp} from "../core/util"
import {Subject} from "../core/react"
import {Encoder, Decoder, setTextCodec} from "../core/codec"
import {getPropMetas, dobject, dmap, dvalue, dcollection, dqueue} from "./meta"
import {Auth, ID, DObject, DQueueAddr, MetaMsg, Path, findObjectType} from "./data"
import {addObject, getObject} from "./protocol"
import {Address, Client, Connection} from "./client"
import {DataStore, Session} from "./server"

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

const sysauth = {id: "system", isSystem: true}

test("access", () => {
  const store = new DataStore(RootObject)
  const auth1 = {id: "1", isSystem: false}
  const auth2 = {id: "2", isSystem: false}

  store.create<UserObject>(sysauth, [], "users", "1").onValue(user => {
    if (user instanceof Error) throw user

    expect(user.key).toEqual("1")

    expect(user.canSubscribe(auth1)).toEqual(true)
    expect(user.canSubscribe(auth2)).toEqual(false)

    expect(user.canWrite("username", auth1)).toEqual(true)
    expect(user.canWrite("username", sysauth)).toEqual(true)

    expect(user.canWrite("lastLogin", auth1)).toEqual(false)
    expect(user.canWrite("lastLogin", sysauth)).toEqual(true)
  })
})

test("codec", () => {
  const store = new DataStore(RootObject)
  store.create<RoomObject>(sysauth, [], "rooms", "1").onValue(room => {
    if (room instanceof Error) throw room

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
    const droom = getObject(dec, 0, {
      get: oid => { throw new Error(`unused`) },
      create: oid => new RoomObject(store.source, ["rooms", "1"], oid)
    }) as RoomObject


    expect(droom.name.current).toEqual(room.name.current)
    expect(Array.from(droom.occupants)).toEqual(Array.from(room.occupants))
    expect(droom.nextMsgId.current).toEqual(room.nextMsgId.current)
    expect(Array.from(droom.messages)).toEqual(Array.from(room.messages))
  })
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

class ClientHandler extends Session {
  constructor (store :DataStore, id :ID, readonly conn :Connection) { super(store, id) }
  sendMsg (msg :Uint8Array) { this.conn.client.recvMsg(msg) }
}

class TestConnection extends Connection {
  private readonly handler :ClientHandler

  constructor (client :Client, addr :Address, store :DataStore, id :ID) {
    super(client, addr)
    this.handler = new ClientHandler(store, id, this)
  }

  sendMsg (msg :Uint8Array) { this.handler.handleMsg(msg) }
  dispose () { this.handler.dispose() }
  protected connect (addr :Address) {} // nothing
}

test("client-server", () => {
  const testAddr = {host: "test", port: 0, path: "/"}
  const testLocator = (path :Path) => Subject.constant(testAddr)
  const testStore = new DataStore(RootObject)

  testStore.create(sysauth, [], "users", "a").onValue(res => {
    if (res instanceof Error) throw res
  })
  testStore.create(sysauth, [], "users", "b").onValue(res => {
    if (res instanceof Error) throw res
  })

  const clientA = new Client(testLocator, (c, a) => new TestConnection(c, a, testStore, "a"))
  // const clientB = new Client(testLocator, (c, a) => new TestConnection(c, a, testServer, "b"))

  clientA.resolve(["users", "a"], UserObject).once(resAA => {
    if (resAA instanceof Error) throw resAA
    resAA.username.update("User A")
    resAA.username.onValue(username => expect(username).toEqual("User A"))
  })

  // try to subscribe to user b's object via a, should fail
  clientA.resolve(["users", "b"], UserObject).once(resAB => {
    if (!(resAB instanceof Error)) throw new Error(`Expected access denied, got ${resAB}.`)
    expect(resAB.message).toEqual("Access denied.")
  })

  clientA.resolve(["users", "c"], UserObject).once(resAC => {
    if (!(resAC instanceof Error)) throw new Error(`Expected no such object, got ${resAC}.`)
    expect(resAC.message).toEqual(`No object at path '${["users", "c"]}'`)
  })
})
