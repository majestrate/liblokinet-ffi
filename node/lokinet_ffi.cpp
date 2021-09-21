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
        lokinet_context_free(ctx);
      }
    };

    std::unique_ptr<lokinet_context, context_deleter> m_Context;

    Napi::Value
    Start(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (auto err = lokinet_context_start(*this))
      {
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
        return env.Undefined();
      }

      while (lokinet_wait_for_ready(100, *this))
        ;

      return env.Undefined();
    }

    Napi::Value
    Stop(const Napi::CallbackInfo& info)
    {
      m_Context.reset();
      return info.Env().Undefined();
    }

    Napi::Value
    Addr(const Napi::CallbackInfo& info)
    {
      return Napi::String::New(info.Env(), lokinet_address(*this));
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
              reinterpret_cast<const char*>(buf.Data()), buf.ByteLength(), *this))
      {
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
      }
      return env.Undefined();
    }

    Napi::Value
    InboundStream(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 1)
      {
        Napi::Error::New(env, "Expected exactly one argument").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[0].IsNumber())
      {
        Napi::Error::New(env, "Expected a number").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (auto id =
              lokinet_inbound_stream(static_cast<uint32_t>(info[0].As<Napi::Number>()), *this);
          id > 0)
      {
        return Napi::Number::New(env, id);
      }
      return env.Undefined();
    }

    Napi::Value
    OutboundStream(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 1)
      {
        Napi::Error::New(env, "Expected exactly one argument").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[0].IsString())
      {
        Napi::Error::New(env, "Expected a string").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      const std::string remote = info[0].As<Napi::String>();
      lokinet_stream_result result{};
      lokinet_outbound_stream(&result, remote.c_str(), nullptr, *this);
      if (result.error)
      {
        Napi::Error::New(env, strerror(result.error)).ThrowAsJavaScriptException();
        return env.Undefined();
      }

      Napi::Object obj = Napi::Object::New(env);
      obj.Set(
          Napi::String::New(env, "host"),
          Napi::String::New(env, std::string{result.local_address}));
      obj.Set(Napi::String::New(env, "port"), Napi::Number::New(env, result.local_port));
      obj.Set(Napi::String::New(env, "id"), Napi::Number::New(env, result.stream_id));
      return obj;
    }

    Napi::Value
    CloseStream(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 1)
      {
        Napi::Error::New(env, "Expected exactly one argument").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[0].IsNumber())
      {
        Napi::Error::New(env, "Expected a number").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      lokinet_close_stream(static_cast<int32_t>(info[0].As<Napi::Number>()), *this);
      return env.Undefined();
    }

    operator lokinet_context*()
    {
      return m_Context.get();
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
           InstanceMethod("inbound_stream", &Context::InboundStream),
           InstanceMethod("outbound_stream", &Context::OutboundStream),
           InstanceMethod("close_stream", &Context::CloseStream),
           InstanceMethod("stop", &Context::Stop),
           InstanceMethod("addr", &Context::Addr)});

      Napi::FunctionReference* constructor = new Napi::FunctionReference{};
      *constructor = Napi::Persistent(func);
      env.SetInstanceData(constructor);
      return func;
    }

    Context(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<Context>{info}, m_Context{lokinet_context_new()}
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
