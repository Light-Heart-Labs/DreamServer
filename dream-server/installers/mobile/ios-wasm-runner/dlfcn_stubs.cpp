#include <cstddef>

extern "C" {

void * dlopen(const char *, int) {
    return nullptr;
}

void * dlsym(void *, const char *) {
    return nullptr;
}

int dlclose(void *) {
    return 0;
}

char * dlerror() {
    static char msg[] = "dynamic backend loading is unavailable in wasi";
    return msg;
}

}
