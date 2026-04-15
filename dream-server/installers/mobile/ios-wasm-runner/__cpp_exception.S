#ifdef __wasm_exception_handling__
#ifdef __wasm64__
#define PTR i64
#else
#define PTR i32
#endif
.globl __cpp_exception
.tagtype __cpp_exception PTR
__cpp_exception:
#endif
