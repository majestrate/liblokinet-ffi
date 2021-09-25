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

    static constexpr int DefaultUDPTimeout = 30;  // in seconds

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

    struct UDPFlow
    {
      Napi::Env env;
      Napi::Function recv;
      Napi::Function timeout;
      Napi::Object resource;
      lokinet_udp_flowinfo info;
    };

    struct UDPSocket
    {
      Napi::Env env;
      Napi::Function callback;
      Napi::Object resource;
    };

    static int
    UDPFilter(void* user, const lokinet_udp_flowinfo* info, void** conn_user, int* timeout)
    {
      UDPSocket* self = static_cast<UDPSocket*>(user);

      Napi::Object args = Napi::Object::New(self->env);

      args.Set(
          Napi::String::New(self->env, "host"),
          Napi::String::New(self->env, std::string{info->remote_host}));
      args.Set(
          Napi::String::New(self->env, "port"), Napi::Number::New(self->env, info->remote_port));
      args.Set(Napi::String::New(self->env, "id"), Napi::Number::New(self->env, info->socket_id));

      Napi::AsyncContext context{self->env, "UDPFilter", self->resource};

      Napi::Value ret = self->callback.MakeCallback(Napi::Object::New(self->env), {args}, context);
      if (not ret.IsArray())
      {
        return EINVAL;
      }
      Napi::Array vals = ret.As<Napi::Array>();
      if (vals.Length() != 2)
      {
        return EINVAL;
      }
      if (not(vals.Get(uint32_t{0}).IsFunction() and vals.Get(uint32_t{1}).IsFunction()))
      {
        return EINVAL;
      }

      UDPFlow* flow = new UDPFlow{
          self->env,
          vals.Get(uint32_t{0}).As<Napi::Function>(),
          vals.Get(uint32_t{1}).As<Napi::Function>(),
          args,
          *info};
      *conn_user = flow;
      *timeout = Context::DefaultUDPTimeout;
      return 0;
    }

    static void
    UDPRecv(const lokinet_udp_flowinfo* remote, const char* data, size_t len, void* user)
    {
      UDPFlow* flow = static_cast<UDPFlow*>(user);

      std::string data_buf{data, len};

      Napi::Object args = Napi::Object::New(flow->env);

      args.Set(Napi::String::New(flow->env, "flow"), Napi::External<UDPFlow>::New(flow->env, flow));

      args.Set(
          Napi::String::New(flow->env, "host"),
          Napi::String::New(flow->env, std::string{remote->remote_host}));
      args.Set(
          Napi::String::New(flow->env, "port"), Napi::Number::New(flow->env, remote->remote_port));
      args.Set(Napi::String::New(flow->env, "id"), Napi::Number::New(flow->env, remote->socket_id));
      args.Set(Napi::String::New(flow->env, "data"), Napi::String::New(flow->env, data_buf));

      Napi::AsyncContext context{flow->env, "UDPRecv", flow->resource};
      flow->recv.MakeCallback(Napi::Object::New(flow->env), {args}, context);
    }

    static void
    UDPTimeout(const lokinet_udp_flowinfo* remote, void* user)
    {
      // steal bare pointer
      std::unique_ptr<UDPFlow> flow = std::unique_ptr<UDPFlow>(static_cast<UDPFlow*>(user));
      Napi::Object args = Napi::Object::New(flow->env);

      args.Set(
          Napi::String::New(flow->env, "host"),
          Napi::String::New(flow->env, std::string{remote->remote_host}));
      args.Set(
          Napi::String::New(flow->env, "port"), Napi::Number::New(flow->env, remote->remote_port));
      args.Set(Napi::String::New(flow->env, "id"), Napi::Number::New(flow->env, remote->socket_id));

      Napi::AsyncContext context{flow->env, "UDPTimeout", flow->resource};
      flow->timeout.MakeCallback(Napi::Object::New(flow->env), {args}, context);
    }

    Napi::Value
    UDPBind(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 2)
      {
        Napi::Error::New(env, "Expected exactly two arguments").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[0].IsNumber())
      {
        Napi::Error::New(env, "Expected a number as first arg").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[1].IsFunction())
      {
        Napi::Error::New(env, "Expected a function as second arg").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      UDPSocket* sock = new UDPSocket{env, info[1].As<Napi::Function>(), Napi::Object::New(env)};
      lokinet_udp_bind_result result{};
      if (auto err = lokinet_udp_bind(
              static_cast<int32_t>(info[0].As<Napi::Number>()),
              UDPFilter,
              UDPRecv,
              UDPTimeout,
              sock,
              &result,
              *this))
      {
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
        return env.Undefined();
      }
      return Napi::Number::New(env, result.socket_id);
    }
    static void
    NewOutboundUDPFlow(void* user, void** flowuser, int* timeout)
    {
      UDPFlow* flow = static_cast<UDPFlow*>(user);
      *timeout = Context::DefaultUDPTimeout;
    }

    Napi::Value
    UDPEstablish(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 5)
      {
        Napi::Error::New(env, "Expected 5 arguments").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[0].IsNumber())
      {
        Napi::Error::New(env, "Expected a socket id (Number) as first arg")
            .ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[1].IsString())
      {
        Napi::Error::New(env, "Expected a string (hostname) as second arg")
            .ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[2].IsNumber())
      {
        Napi::Error::New(env, "Expected a port (Number) as third arg").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[3].IsFunction())
      {
        Napi::Error::New(env, "Expected a function as fourth arg").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[4].IsFunction())
      {
        Napi::Error::New(env, "Expected a function as fith arg").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      lokinet_udp_flowinfo remote{};

      remote.socket_id = info[0].As<Napi::Number>();

      std::string host = info[1].As<Napi::String>();
      std::copy_n(
          host.data(), std::min(sizeof(remote.remote_host), host.size()), remote.remote_host);

      remote.remote_port = static_cast<uint32_t>(info[2].As<Napi::Number>());

      UDPFlow* flow = new UDPFlow{
          env,
          info[3].As<Napi::Function>(),
          info[4].As<Napi::Function>(),
          Napi::Object::New(env),
          remote};
      if (auto err = lokinet_udp_establish(&Context::NewOutboundUDPFlow, flow, &remote, *this))
      {
        delete flow;
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
        return env.Undefined();
      }

      return Napi::External<UDPFlow>::New(env, flow);
    }

    Napi::Value
    UDPFlowSend(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 2)
      {
        Napi::Error::New(env, "Expected 2 arguments").ThrowAsJavaScriptException();
        return env.Undefined();
      }

      if (not info[0].IsExternal())
      {
        Napi::Error::New(env, "Expected a flow as first arg").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[1].IsArrayBuffer())
      {
        Napi::Error::New(env, "Expected an arraybuffer as second arg").ThrowAsJavaScriptException();
        return env.Undefined();
      }

      Napi::External<UDPFlow> flow = info[0].As<Napi::External<UDPFlow>>();
      Napi::ArrayBuffer data = info[1].As<Napi::ArrayBuffer>();

      if (auto err =
              lokinet_udp_flow_send(&flow.Data()->info, data.Data(), data.ByteLength(), *this))
      {
        Napi::Error::New(env, strerror(err)).ThrowAsJavaScriptException();
      }
      return env.Undefined();
    }

    Napi::Value
    UDPClose(const Napi::CallbackInfo& info)
    {
      auto env = info.Env();
      if (info.Length() != 1)
      {
        Napi::Error::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
        return env.Undefined();
      }
      if (not info[0].IsNumber())
      {
        Napi::Error::New(env, "Argument must be a number").ThrowAsJavaScriptException();
        return env.Undefined();
      }

      lokinet_udp_close(static_cast<int32_t>(info[0].As<Napi::Number>()), *this);
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
           InstanceMethod("udp_bind", &Context::UDPBind),
           InstanceMethod("udp_establish", &Context::UDPEstablish),
           InstanceMethod("udp_flow_send", &Context::UDPFlowSend),
           InstanceMethod("udp_close", &Context::UDPClose),
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

  Napi::Value
  HexToBase32z(const Napi::CallbackInfo& info)
  {
    auto env = info.Env();
    if (info.Length() != 1)
    {
      Napi::Error::New(env, "Expected exactly 1 argument").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (not info[0].IsString())
    {
      Napi::Error::New(env, "Argument not a string").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    const std::string hex = info[0].As<Napi::String>();
    return Napi::String::New(env, lokinet_hex_to_base32z(hex.c_str()));
  }

}  // namespace lokinet

static Napi::Object
Init(Napi::Env env, Napi::Object exports)
{
  exports.Set(Napi::String::New(env, "Context"), lokinet::Context::Init(env, exports));
  exports.Set(
      Napi::String::New(env, "hex_to_base32z"), Napi::Function::New<lokinet::HexToBase32z>(env));
  return exports;
}

NODE_API_MODULE(liblokinet, Init)
