import * as fs from "fs"
import * as p from "path"
import {ResourceLoader} from "./loader"

/** Creates a resource loader that loads resources via the Node `file` API and optionally watches
  * them for changes. */
export function fileLoader (baseUrl :string, baseDir :string, watch = false) {
  const loader :ResourceLoader = new ResourceLoader(baseUrl, (path, loaded, failed) => {
    fs.readFile(p.join(baseDir, path), "utf8", (err, data) => err ? failed(err) : loaded(data))
  }, !watch ? undefined : path => {
    const watcher = fs.watch(p.join(baseDir, path), () => loader.noteUpdated(path))
    return () => watcher.close()
  })
  return loader
}
