# liblokinet ffi wrapper

collection of ffi wrappers for liblokinet

## checkout

get submdoules:

    $ git submodule update --init --recursive

## building

nodejs:

    $ npm install

nodejs (faster):

    $ CMAKE_BUILD_PARALLEL_LEVEL=$(nproc) npm install

## running

run the nodejs demo:

    $ npm start


## development

making a dev build:

    $ CMAKE_BUILD_PARALLEL_LEVEL=$(nproc) npm run dev:compile
