import {UUID, UUID0, uuidv1} from "../core/uuid"
import {Timestamp} from "../core/util"
import {Subject} from "../core/react"
import {Encoder, Decoder, setTextCodec} from "../core/codec"
import {getPropMetas, dconst, dobject, dmap, dvalue, dcollection, dqueue} from "./meta"
import {Auth, AutoKey, DataSource, DKey, DObject, MetaMsg, Path, findObjectType} from "./data"
import {addObject, getObject} from "./protocol"
import {Address, Client, Connection} from "./client"
import {DataStore, Session} from "./server"

import {TextEncoder, TextDecoder} from "util"
setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

// @ts-ignore: sigh jest
Object.defineProperty(global.self, 'crypto', {value: require('crypto')})

//
// User object: maintains info on a user

@dobject
export class UserObject extends DObject {

  @dvalue("string")
  username = this.value("")

  @dvalue("timestamp")
  lastLogin = this.value(0)

  @dvalue("size32")
  currentRoom = this.value<number>(0)

  @dqueue(handleUserReq)
  userq = this.queue<UserReq>()

  canSubscribe (auth :Auth) { return auth.id === this.key || super.canSubscribe(auth) }
  canWrite (prop :string, who :Auth) { return (prop === "username") || super.canWrite(prop, who) }
}

type UserReq = {type: "enter", room: number}

function handleUserReq (obj :UserObject, req :UserReq, auth :Auth) {
  switch (req.type) {
  case "enter":
    if (auth.isSystem) {
      obj.currentRoom.update(req.room)
      obj.source.post(RoomObject.queueAddr(["rooms", req.room], "roomq"),
                      {type: "joined", id: obj.key, username: obj.username.current})
    }
  }
}

//
// Room object: handles data for a single chat room

type MID = number

type RoomReq = {type: "join", id :UUID}
             | {type: "joined", id :UUID, username :string}
             | {type: "speak", text :string}
             | {type: "edit", mid :MID, newText :string}
             | {type: "delete"}

interface Message {
  sender :UUID
  sent :Timestamp
  text :string
  edited? :Timestamp
}

interface OccupantInfo {
  username :string
}

@dobject
export class RoomObject extends DObject {

  constructor (source :DataSource, path :Path, owner :UUID) {
    super(source, path)
    this.owner = owner
  }

  @dconst("uuid")
  readonly owner :UUID

  @dvalue("string")
  name = this.value("")

  @dmap("uuid", "record")
  occupants = this.map<UUID, OccupantInfo>()

  @dvalue("size32")
  nextMsgId = this.value(1)

  @dmap("size32", "record")
  messages = this.map<MID, Message>()

  @dqueue(handleRoomReq)
  roomq = this.queue<RoomReq>()

  @dqueue(handleMetaMsg)
  metaq = this.queue<MetaMsg>()

  canSubscribe (auth :Auth) { return this.occupants.has(auth.id) || super.canSubscribe(auth) }
}

function handleRoomReq (obj :RoomObject, req :RoomReq, auth :Auth) {
  switch (req.type) {
  case "join":
    // we could do an auth or ban list check here
    obj.occupants.set(req.id, {username: "?"})
    obj.source.post(UserObject.queueAddr(["users", auth.id], "userq"), {type: "enter", room: obj.key})
    break

  case "joined":
    if (auth.isSystem) {
      const info = obj.occupants.get(req.id)
      if (info) obj.occupants.set(req.id, {...info, username: req.username})
    }
    break

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
  }
}

function handleMetaMsg (obj :RoomObject, msg :MetaMsg, auth :Auth) {
  switch (msg.type) {
  case "unsubscribed":
    obj.occupants.delete(msg.userId)
    break
  }
}

//
// Root object: manages chat rooms

type ChatReq = {type :"create" , name :string}

interface RoomInfo {
  name :string
  occupants :number
}

@dobject
export class RootObject extends DObject {

  canSubscribe (auth :Auth) { return true }

  @dmap("size32", "record")
  publicRooms = this.map<number, RoomInfo>()

  @dcollection("string", UserObject, "uuid")
  users = this.collection<UUID, UserObject>()

  @dcollection("size32", RoomObject, "sequential")
  rooms = this.collection<number, RoomObject>()

  @dqueue(handleChatReq)
  chatq = this.queue<ChatReq>()
}

function handleChatReq (obj :RootObject, req :ChatReq, auth :Auth) {
  switch (req.type) {
  case "create":
    obj.rooms.create(AutoKey, auth.id).once(res => {
      if (typeof res === "string") obj.source.post(
        UserObject.queueAddr(["users", auth.id], "userq"), {type: "enter", room: res})
    })
    // TODO: need to get key for room & send it back to requester
    break
  }
}

test("metas", () => {
  const rmetas = getPropMetas(RootObject.prototype)
  expect(rmetas[0]).toEqual({type: "map", name: "publicRooms", index: 0,
                             ktype: "size32", vtype: "record"})
  expect(rmetas[1]).toEqual({type: "collection", name: "users", index: 1,
                             ktype: "string", otype: UserObject, autoPolicy: "uuid"})
  expect(rmetas[3]).toEqual({type: "queue", name: "chatq", index: 3, handler: handleChatReq})

  const umetas = getPropMetas(UserObject.prototype)
  expect(umetas[0]).toEqual({type: "value", name: "username", index: 0, vtype: "string"})
  expect(umetas[1]).toEqual({type: "value", name: "lastLogin", index: 1, vtype: "timestamp"})

  const rmmetas = getPropMetas(RoomObject.prototype)
  expect(rmmetas[0]).toEqual({type: "const", name: "owner", index: 0, vtype: "uuid"})
  expect(rmmetas[1]).toEqual({type: "value", name: "name", index: 1, vtype: "string"})
})

const sysauth = {id: UUID0, isSystem: true}

function createAndResolve<T extends DObject> (
  store :DataStore, auth :Auth, ppath :Path, cprop :string, key :DKey, ...args :any[]
) :Subject<T|Error> {
  return store.create(auth, ppath, cprop, key, ...args).
    switchMap(kres => (kres instanceof Error) ?
              Subject.constant(kres) :
              store.resolve<T>(ppath.concat([cprop, kres])))
}

test("access", () => {
  const store = new DataStore(RootObject)
  const auth1 = {id: uuidv1(), isSystem: false}
  const auth2 = {id: uuidv1(), isSystem: false}

  createAndResolve(store, sysauth, [], "users", auth1.id).onValue(user => {
    if (user instanceof Error) throw user

    expect(user.key).toEqual(auth1.id)

    expect(user.canSubscribe(auth1)).toEqual(true)
    expect(user.canSubscribe(auth2)).toEqual(false)

    expect(user.canWrite("username", auth1)).toEqual(true)
    expect(user.canWrite("username", sysauth)).toEqual(true)

    expect(user.canWrite("lastLogin", auth1)).toEqual(false)
    expect(user.canWrite("lastLogin", sysauth)).toEqual(true)
  })
})

test("codec", () => {
  const store = new DataStore(RootObject), ownerId = uuidv1()
  createAndResolve<RoomObject>(store, sysauth, [], "rooms", "1", ownerId).onValue(room => {
    if (room instanceof Error) throw room

    expect(room.owner).toEqual(ownerId)

    const id1 = uuidv1(), id2 = uuidv1()
    room.name.update("Test room")
    room.occupants.set(id1, {username: "Testy Testerson"})
    room.occupants.set(id2, {username: "Sandy Clause"})
    room.nextMsgId.update(4)
    const now = Timestamp.now()
    room.messages.set(1, {sender: id1, sent: now-5*60*1000, text: "Yo Sandy!"})
    room.messages.set(2, {sender: id2, sent: now-3*60*1000, text: "Hiya Testy."})
    room.messages.set(3, {sender: id1, sent: now-1*60*1000, text: "How's the elves?"})

    const enc = new Encoder()
    addObject(sysauth, room, enc)

    const msg = enc.finish()
    const dec = new Decoder(msg)
    const droom = getObject(dec, 0, {
      get: oid => { throw new Error(`unused`) },
      info: oid => ({otype: RoomObject, source: store.source, path: ["rooms", "1"]})
    }) as RoomObject

    expect(droom.owner).toEqual(room.owner)
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
  cs = this.collection<UUID, CObject>()
}
class AObject extends DObject {
  @dcollection("string", BObject)
  bs = this.collection<UUID, BObject>()
  @dcollection("string", CObject)
  cs = this.collection<UUID, CObject>()
}

test("findObjectType", () => {
  expect(findObjectType(RootObject, [])).toStrictEqual(RootObject)
  expect(findObjectType(RootObject, ["rooms", "1"])).toStrictEqual(RoomObject)
  expect(findObjectType(RootObject, ["users", "1"])).toStrictEqual(UserObject)
  expect(findObjectType(AObject, ["cs", "1"])).toStrictEqual(CObject)
  expect(findObjectType(AObject, ["bs", "1", "cs", "1"])).toStrictEqual(CObject)
})

class ClientHandler extends Session {
  constructor (store :DataStore, id :UUID, readonly conn :Connection) { super(store, id) }
  sendMsg (msg :Uint8Array) { this.conn.client.recvMsg(msg) }
}

class TestConnection extends Connection {
  private readonly handler :ClientHandler

  constructor (client :Client, addr :Address, store :DataStore, id :UUID) {
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

  const ida = uuidv1(), idb = uuidv1()
  testStore.create(sysauth, [], "users", ida).onValue(res => {
    if (res instanceof Error) throw res
  })
  testStore.create(sysauth, [], "users", idb).onValue(res => {
    if (res instanceof Error) throw res
  })

  const clientA = new Client(testLocator, (c, a) => new TestConnection(c, a, testStore, ida))
  // const clientB = new Client(testLocator, (c, a) => new TestConnection(c, a, testServer, "b"))

  clientA.resolve(["users", ida], UserObject).once(resAA => {
    if (resAA instanceof Error) throw resAA
    resAA.username.update("User A")
    resAA.username.onValue(username => expect(username).toEqual("User A"))
  })

  // try to subscribe to user b's object via a, should fail
  clientA.resolve(["users", idb], UserObject).once(resAB => {
    if (!(resAB instanceof Error)) throw new Error(`Expected access denied, got ${resAB}.`)
    expect(resAB.message).toEqual("Access denied.")
  })

  const idc = uuidv1()
  clientA.resolve(["users", idc], UserObject).once(resAC => {
    if (!(resAC instanceof Error)) throw new Error(`Expected no such object, got ${resAC}.`)
    expect(resAC.message).toEqual(`No object at path '${["users", idc]}'`)
  })
})
