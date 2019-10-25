import {ID, Domain, LifecycleEvent, EntityConfig, SparseValueComponent, DenseValueComponent,
        Matcher, System} from "./entity"

function mkEv<T> (type :T, id :ID) { return {type, id} }

const EmptyConfig = {components: {}}

test("entity lifecycle events", () => {
  const domain = new Domain({}, {})
  const history :LifecycleEvent[] = []
  domain.events.onEmit(ev => history.push(ev))
  const exhist :LifecycleEvent[] = []

  const id0 = domain.add(EmptyConfig, true)
  exhist.push(mkEv("added", id0), mkEv("enabled", id0))
  expect(history).toEqual(exhist)
  domain.delete(id0)
  exhist.push(mkEv("disabled", id0), mkEv("deleted", id0))
  expect(history).toEqual(exhist)

  const id1 = domain.add(EmptyConfig, false)
  exhist.push(mkEv("added", id1))
  expect(history).toEqual(exhist)
  domain.delete(id1)
  exhist.push(mkEv("deleted", id1))
  expect(history).toEqual(exhist)

  const id2 = domain.add(EmptyConfig, false)
  exhist.push(mkEv("added", id2))
  expect(history).toEqual(exhist)
  domain.enable(id2)
  exhist.push(mkEv("enabled", id2))
  domain.enable(id2) // should not emit another event
  expect(history).toEqual(exhist)
  domain.delete(id2)
  exhist.push(mkEv("disabled", id2), mkEv("deleted", id2))
  expect(history).toEqual(exhist)
})

test("entity id reuse", () => {
  const domain = new Domain({}, {})

  const ids = []
  for (let ii = 0; ii < 100; ii += 1) ids.push(domain.add(EmptyConfig))
  for (let ii = 0; ii < 100; ii += 2) domain.delete(ids[ii])
  for (let ii = 0; ii < 100; ii += 2) expect(domain.add(EmptyConfig)).toEqual(ids[ii])
})

test("flat value component", () => {
  const DefaultName = "default"
  const name = new DenseValueComponent<string>("name", DefaultName)
  const age = new SparseValueComponent<number|undefined>("age", undefined)
  const domain = new Domain({}, {name, age})

  const id0 = domain.add({components: {name: {}}})
  expect(name.read(id0)).toEqual(DefaultName)
  name.update(id0, "foo")
  expect(name.read(id0)).toEqual("foo")

  const id1 = domain.add({components: {name: {initial: "bar"}}})
  expect(name.read(id1)).toEqual("bar")
  name.update(id1, "baz")
  expect(name.read(id1)).toEqual("baz")

  const id2 = domain.add({components: {age: {initial: 1}}})
  expect(age.read(id2)).toEqual(1)

  const id3 = domain.add({components: {age: {}}})
  expect(age.read(id3)).toBe(undefined)
})

test("system iteration", () => {
  const name = new DenseValueComponent<string>("name", "<noname>")
  const age = new DenseValueComponent<number>("age", 0)
  const domain = new Domain({}, {name, age})
  const sys1 = new System(domain, Matcher.hasAllC("name", "age"))
  const sys2 = new System(domain, Matcher.hasC("name"))

  const configs :EntityConfig[] = [{components: {name: {}}},
                                   {components: {age: {}}},
                                   {components: {name: {}, age: {}}}]
  const ids = configs.map(_ => new Set<ID>())

  for (let ii = 0; ii < 100; ii += 1) {
    const cidx = ii%configs.length
    ids[cidx].add(domain.add(configs[cidx]))
  }

  let sys1count = 0
  sys1.onEntities(id => { sys1count += 1 ; expect(ids[2].has(id)).toBe(true) })
  expect(sys1count).toBe(ids[2].size)

  let sys2count = 0
  sys2.onEntities(id => { sys2count += 1 ; expect(ids[0].has(id) || ids[2].has(id)).toBe(true) })
  expect(sys2count).toBe(ids[0].size + ids[2].size)
})

test("value observer", () => {
  const DefaultName = "default"
  const name = new SparseValueComponent<string>("name", DefaultName)
  const age = new DenseValueComponent<number>("age", 0)
  const domain = new Domain({}, {name, age})

  const id0 = domain.add({components: {name: {}, age: {}}})
  const nv0 = name.getValue(id0)
  const nvh :string[] = []
  nv0.onValue(n => nvh.push(n))
  expect(nvh).toStrictEqual([DefaultName])

  name.update(id0, "foo")
  expect(name.read(id0)).toEqual("foo")
  expect(nvh).toStrictEqual([DefaultName, "foo"])

  const av0 = age.getValue(id0)
  const avh :number[] = []
  av0.onValue(n => avh.push(n))
  expect(avh).toStrictEqual([0])

  age.update(id0, 42)
  expect(age.read(id0)).toEqual(42)
  expect(avh).toStrictEqual([0, 42])

  age.update(id0, 42)
  expect(age.read(id0)).toEqual(42)
  expect(avh).toStrictEqual([0, 42])
})
