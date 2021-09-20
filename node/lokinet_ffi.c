#include <node_api.h>
#include <lokinet.h>

#define NAPI_CALL(env, call)                                                                   \
  do                                                                                           \
  {                                                                                            \
    napi_status status = (call);                                                               \
    if (status != napi_ok)                                                                     \
    {                                                                                          \
      const napi_extended_error_info* error_info = NULL;                                       \
      napi_get_last_error_info((env), &error_info);                                            \
      bool is_pending;                                                                         \
      napi_is_exception_pending((env), &is_pending);                                           \
      if (!is_pending)                                                                         \
      {                                                                                        \
        const char* message = (error_info->error_message == NULL) ? "empty error message"      \
                                                                  : error_info->error_message; \
        napi_throw_error((env), NULL, message);                                                \
        return NULL;                                                                           \
      }                                                                                        \
    }                                                                                          \
  } while (0)


static napi_value
CallTheShit(napi_env env, napi_callback_info info) {
  // Do some shit.
  return NULL;
}

napi_value
create_liblokinet(napi_env env)
{
  napi_value result;
  NAPI_CALL(env, napi_create_object(env, &result));

  napi_value exported_function;
  NAPI_CALL(
      env,
      napi_create_function(
          env, "callTheShit", NAPI_AUTO_LENGTH, CallTheShit, NULL, &exported_function));

  NAPI_CALL(env, napi_set_named_property(env, result, "callTheShit", exported_function));

  return result;
}

#undef NAPI_CALL

NAPI_MODULE_INIT()
{
  return create_liblokinet(env);
}
