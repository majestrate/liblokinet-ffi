#include <napi.h>
#include <lokinet.h>

#include <memory>

namespace lokinet
{
  class Context : public Napi::ObjectWrap<Context>
  {
    struct context_deleter
    {
      void
      operator()(lokinet_context* ctx) const
      {
        if (ctx)
        {
          lokinet_context_stop(ctx);
          lokinet_context_free(ctx);
        }
      }
    };

    std::unique_ptr<lokinet_context, context_deleter> m_Context;

    Napi::Value
    Start(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (auto err = lokinet_context_start(m_Context.get()))
      {
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
        return env.Undefined();
      }

      while (lokinet_wait_for_ready(100, m_Context.get()))
        ;

      return env.Undefined();
    }

    Napi::Value
    Stop(const Napi::CallbackInfo& info)
    {
      lokinet_context_stop(m_Context.get());
      return info.Env().Undefined();
    }

    Napi::Value
    Addr(const Napi::CallbackInfo& info)
    {
      return Napi::String::New(info.Env(), lokinet_address(m_Context.get()));
    }

    Napi::Value
    Bootstrap(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 1)
      {
        Napi::Error::New(env, "Expected exactly one argument").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[0].IsArrayBuffer())
      {
        Napi::Error::New(env, "Expected an ArrayBuffer").ThrowAsJavaScriptException();
        return env.Undefined();
      }

      Napi::ArrayBuffer buf = info[0].As<Napi::ArrayBuffer>();
      if (auto err = lokinet_add_bootstrap_rc(
              reinterpret_cast<const char*>(buf.Data()), buf.ByteLength(), m_Context.get()))
      {
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
      }
      return env.Undefined();
    }

   public:
    static Napi::Function
    Init(Napi::Env env, Napi::Object exports)
    {
      Napi::Function func = DefineClass(
          env,
          "Context",
          {InstanceMethod("start", &Context::Start),
           InstanceMethod("bootstrap", &Context::Bootstrap),
           InstanceMethod("stop", &Context::Stop),
           InstanceMethod("addr", &Context::Addr)});

      Napi::FunctionReference* constructor = new Napi::FunctionReference{};
      *constructor = Napi::Persistent(func);
      env.SetInstanceData(constructor);
      return func;
    }

    Context(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Context>{info},
                                              m_Context{lokinet_context_new()}
    {}
  };
}  // namespace lokinet

static Napi::Object
Init(Napi::Env env, Napi::Object exports)
{
  exports.Set(Napi::String::New(env, "Context"), lokinet::Context::Init(env, exports));
  return exports;
}

NODE_API_MODULE(liblokinet, Init)
