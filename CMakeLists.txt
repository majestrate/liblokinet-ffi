cmake_minimum_required(VERSION 3.7)
set (CMAKE_CXX_STANDARD 17)

set(CMAKE_OSX_DEPLOYMENT_TARGET 10.12 CACHE STRING "macOS deployment target (Apple clang only)")

project (liblokinet_js)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/external/lokinet)

include_directories(${CMAKE_JS_INC})
add_library(${PROJECT_NAME} SHARED ${CMAKE_CURRENT_SOURCE_DIR}/node/lokinet_ffi.cpp ${CMAKE_CURRENT_SOURCE_DIR}/external/lokinet/llarp/lokinet_shared.cpp ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB} liblokinet)
if(WIN32)
  target_link_libraries(${PROJECT_NAME} ws2_32 iphlpapi -fstack-protector)
endif()
add_log_tag(${PROJECT_NAME})

# Include Node-API wrappers
execute_process(COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  )
string(REGEX REPLACE "[\r\n\"]" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

target_include_directories(${PROJECT_NAME} PRIVATE ${NODE_ADDON_API_DIR})

add_definitions(-DNAPI_VERSION=6)
