#include <napi.h>
#include <lokinet.h>

namespace lokinet
{    
  class Context : public Napi::ObjectWrap<Context>
  {
    struct context_deleter
    {
      void operator()(lokinet_context * ctx) const
      {
        if(ctx)
        {
          lokinet_context_stop(ctx);
          lokinet_context_free(ctx);
        }
      }
    };
  
    std::unique_ptr<lokinet_context, context_deleter> m_Context;

    Napi::Value
    Start(const Napi::CallbackInfo & info)
    {
      auto env = info.Env();
      if(auto err = lokinet_context_start(m_Context.get()))
      {
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
        return env.Null();
      }

      while(lokinet_wait_for_ready(100, m_Context.get()));

      return env.Null();
    }
    
    
    Napi::Value
    Stop(const Napi::CallbackInfo & info)
    {
      lokinet_context_stop(m_Context.get());
      return info.Env().Null();
    }

  public:

    static Napi::Function
    Init(Napi::Env env, Napi::Object exports)
    {
      Napi::Function func =
        DefineClass(env,
                    "Context",
                    {InstanceMethod("start", &Context::Start),
                     InstanceMethod("stop", &Context::Stop)
                    });

      Napi::FunctionReference* constructor = new Napi::FunctionReference{};
      *constructor = Napi::Persistent(func);
      env.SetInstanceData(constructor);
      return func;
    }
    
    Context(const Napi::CallbackInfo & info) : Napi::Object<Context>{info},
      m_Context{lokinet_context_new()}
    {
    }
      
  };
}


static Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  exports.Set("Context", Context::Init(env, exports));
  return exports;
}

NODE_API_MODULE(liblokinet, InitModule)
