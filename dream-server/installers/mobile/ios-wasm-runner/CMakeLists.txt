cmake_minimum_required(VERSION 3.20)
project(dream_llama_wasi C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED ENV{DREAM_LLAMA_CPP_SOURCE} OR "$ENV{DREAM_LLAMA_CPP_SOURCE}" STREQUAL "")
    message(FATAL_ERROR "DREAM_LLAMA_CPP_SOURCE must point at a llama.cpp checkout")
endif()

set(LLAMA_CPP_SOURCE "$ENV{DREAM_LLAMA_CPP_SOURCE}")

set(WASI_COMMON_CFLAGS "-D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS")
set(WASI_WASM_EH_FLAGS "-fwasm-exceptions -mllvm -wasm-use-legacy-eh=false")
set(WASI_COMMON_LDFLAGS "-lwasi-emulated-signal -lwasi-emulated-process-clocks -lunwind")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${WASI_COMMON_CFLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${WASI_COMMON_CFLAGS} ${WASI_WASM_EH_FLAGS}")
set(CMAKE_ASM_FLAGS "${CMAKE_ASM_FLAGS} ${WASI_WASM_EH_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${WASI_WASM_EH_FLAGS} ${WASI_COMMON_LDFLAGS}")

set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_WEBUI OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_WASM_MEM64 OFF CACHE BOOL "" FORCE)

add_subdirectory("${LLAMA_CPP_SOURCE}" llama-upstream)

find_package(Threads REQUIRED)

add_executable(dream-llama-wasi
    main.cpp
    __cpp_exception.S
    dlfcn_stubs.cpp
)
target_link_libraries(dream-llama-wasi PRIVATE llama Threads::Threads c++abi c++)
target_compile_features(dream-llama-wasi PRIVATE cxx_std_17)
target_compile_options(dream-llama-wasi PRIVATE -fno-rtti)
