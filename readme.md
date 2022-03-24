# liblokinet ffi wrapper

collection of ffi wrappers for liblokinet

## checkout

get submdoules:

    $ git submodule update --init --recursive

## building

nodejs:

    $ yarn install --frozen-lockfile

nodejs (faster):

    $ CMAKE_BUILD_PARALLEL_LEVEL=$(nproc) yarn install --frozen-lockfile

## running

run the nodejs demo:

    $ yarn start

## development

making a dev build:

    $ CMAKE_BUILD_PARALLEL_LEVEL=$(nproc) yarn compile:dev
