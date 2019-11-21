import {uuidv1} from "../core/uuid"
import {getPropMetas, dobject, dvalue, dcollection, dhierarchy} from "./meta"
import {Auth, DObject} from "./data"
import {MemoryDataStore} from "./server"

@dobject
export class FooObject extends DObject {
  @dvalue("string")
  foo = this.value("")

  @dvalue("number")
  bar = this.value(0)
}

@dobject
export class BaseObject extends DObject {
  @dvalue("string")
  base = this.value("")
}

@dobject
export class SubAObject extends BaseObject {
  static uuid = "4kK0BPBd6GiWZ6eGn0rdLN"

  @dvalue("number")
  suba = this.value(0)
}

@dobject
export class SubBObject extends BaseObject {
  static uuid = "4kKme7JakwOub7ThOXo1FJ"

  @dvalue("boolean")
  subb = this.value(false)
}

@dobject
export class RootObject extends DObject {

  canSubscribe (auth :Auth) { return true }

  @dcollection(FooObject)
  rooms = this.collection<FooObject>()

  @dhierarchy(id => {
    switch (id) {
    case SubAObject.uuid: return SubAObject
    case SubBObject.uuid: return SubBObject
    default: return BaseObject
    }
  })
  bases = this.collection<BaseObject>()
}

test("metas", () => {
  const fmetas = getPropMetas(FooObject.prototype)
  expect(fmetas[0]).toEqual({
    type: "value", name: "foo", index: 0, vtype: "string", persist: false})
  expect(fmetas[1]).toEqual({
    type: "value", name: "bar", index: 1, vtype: "number", persist: false})

  const pmetas = getPropMetas(BaseObject.prototype)
  expect(pmetas[0]).toEqual({
    type: "value", name: "base", index: 0, vtype: "string", persist: false})

  const ametas = getPropMetas(SubAObject.prototype)
  expect(ametas[0]).toEqual({
    type: "value", name: "base", index: 0, vtype: "string", persist: false})
  expect(ametas[1]).toEqual({
    type: "value", name: "suba", index: 1, vtype: "number", persist: false})

  const bmetas = getPropMetas(SubBObject.prototype)
  expect(bmetas[0]).toEqual({
    type: "value", name: "base", index: 0, vtype: "string", persist: false})
  expect(bmetas[1]).toEqual({
    type: "value", name: "subb", index: 1, vtype: "boolean", persist: false})
})

test("hierarchy", () => {
  const store = new MemoryDataStore(RootObject)

  const suba = store.resolve(["bases", SubAObject.uuid]).object as SubAObject
  expect(suba instanceof SubAObject).toBe(true)
  expect(suba.key).toEqual(SubAObject.uuid)
  expect(suba.base.current).toBe("")
  suba.base.update("A")
  expect(suba.base.current).toBe("A")
  expect(suba.suba.current).toBe(0)
  suba.suba.update(42)
  expect(suba.suba.current).toBe(42)

  const subb = store.resolve(["bases", SubBObject.uuid]).object as SubBObject
  expect(subb instanceof SubBObject).toBe(true)
  expect(subb.key).toEqual(SubBObject.uuid)
  expect(subb.base.current).toBe("")
  subb.base.update("B")
  expect(subb.base.current).toBe("B")
  expect(subb.subb.current).toBe(false)
  subb.subb.update(true)
  expect(subb.subb.current).toBe(true)

  const randomKey = uuidv1()
  const base = store.resolve(["bases", randomKey]).object as BaseObject
  expect(base instanceof BaseObject).toBe(true)
  expect(base.key).toEqual(randomKey)
})
