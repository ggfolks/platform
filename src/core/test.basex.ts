import {Base62} from "./basex"

function mkRandomData () {
  const length = 1 + Math.round(Math.random() * 500)
  const data = new Uint8Array(new ArrayBuffer(length))
  for (let ii = 0; ii < length; ii += 1) data[ii] = Math.round(Math.random()*256)
  return data
}

test("basex", () => {
  for (let ii = 0; ii < 500; ii += 1) {
    const data = mkRandomData()
    expect(Base62.decode(Base62.encode(data))).toEqual(data)
  }

  const buffer = new Uint8Array(new ArrayBuffer(16))
  for (let ii = 0; ii < 128; ii += 1) {
    for (let pp = 0; pp < 16; pp += 1) {
      buffer[pp] = ii
      expect(Base62.decode(Base62.encode(buffer))).toEqual(buffer)
      buffer[pp] = 0
    }
  }
})
