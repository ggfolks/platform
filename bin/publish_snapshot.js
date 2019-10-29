#!/usr/bin/env node

const {spawn} = require("child_process")
const package = require("../lib/package.json")

const {name, version} = package
const registry = package.publishConfig.registry

if (!name || !version || !registry) {
  console.warn("Missing data from package.json:")
  console.warn(`- name: '${name}'`)
  console.warn(`- version: '${version}'`)
  console.warn(`- registry: '${registry}'`)
  process.exit(255)
}

const buildNum = process.argv[2]
if (!buildNum) {
  console.warn("Usage: publish_snapshot.js build_number")
  process.exit(255)
}

if (version.includes("-snapshot")) {
  console.warn("Package version already has snapshot? ${version}")
  console.warn("Did a previous publish fail?")
  process.exit(255)
}

const snapVersion = `${version}-snapshot.${buildNum}`

function exec (cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {...options, stdio: "inherit"})
    child.on("error", err => reject(err))
    child.on("exit", code => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} returned exit code ${code}`))
    })
  })
}

async function run () {
  // this doesn't work because Verdaccio just can't even when run with a URL path prefix, sigh

  // const oldVersion = `${version}-snapshot.${buildNum-1}`
  // console.log(`Unpublishing old snapshot version: ${oldVersion}`)

  // try {
  //   await exec("npm", ["unpublish", "--registry", registry, `${name}@${oldVersion}`])
  // } catch (err) {
  //   console.warn(`Unpublish failed (${err.message}), trying publish anyway...`)
  // }

  try {
    console.log(`Publishing new snapshot version: ${snapVersion}`)
    await exec("npm", ["version", snapVersion], {cwd: "lib"})
    await exec("npm", ["publish", "lib", "--tag", "snapshot"])
  } catch (err) {
    console.warn(`Publish failed: ${err.message}`)
  }
  try {
    await exec("npm", ["version", version], {cwd: "lib"})
  } catch (err) {
    console.warn(`Version restoration failed: ${err.message}`)
  }
}
run()
