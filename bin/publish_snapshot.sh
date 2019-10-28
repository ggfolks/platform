#!/bin/bash
#
# Publishes "snapshot" versions of the platform to our local NPM registry. NPM does not support
# snapshot versions, so the way this is accomplished is to unpublish the package and republish it
# under the same version.

# "parse" some info from the package.json file, lol!
NAME=`grep '^  "name"' lib/package.json  | awk -F\" '{ print $4 }'`
VERSION=`grep '^  "version"' lib/package.json  | awk -F\" '{ print $4 }'`
REGISTRY=`grep '^    "registry"' lib/package.json  | awk -F\" '{ print $4 }'`

if [[ $VERSION != *snapshot ]]; then
    echo "$NAME version ($VERSION) does not end with '-snapshot'. Aborting."
    exit 255
fi

# echo $NAME
# echo $VERSION
# echo $REGISTRY

npm unpublish --registry $REGISTRY $NAME@$VERSION
npm publish lib
