import {FileLoader} from "three"
import {Noop} from "../../../core/util"
import {ResourceLoader} from "../../../asset/loader"

/** Configures `loader` to use a Three.js `FileLoader` to load config data. This causes those
  * resources to show up in Three's loading tracking system. */
export function useThreeForData (loader :ResourceLoader) {
  loader.setDataLoader((path, loaded, failed) => {
    new FileLoader().load(loader.getUrl(path), data => loaded(data as string), Noop,
                          errev => failed(new Error(errev.message)))
  })
}
