/** lokinet.js -- liblokinet ffi wrapper */

const ffi = require('ffi-napi');
const ref = require('ref');
const StructType = require('ref-struct');


const _get_libname = () => {
  // TODO: other platforms
  return 'liblokinet.so';
};

const _lokinet_ctx = 'void';
const lokinet_ctx = ref.refType(_lokinet_ctx);

let _stream_result = StructType();
_stream_result.defineProperty('error', ref.types.int);
_stream_result.defineProperty('local_port', ref.types.int);
_stream_result.defineProperty('local_port', ref.types.int);
_stream_result.defineProperty('stream_id', ref.types.int);
_stream_result.defineProperry('local_address', ref.types.CString);
const lokinet_stream_result_t = _stream_result;
const lokinet_stream_result_ptr = ref.refType(lokinet_stream_result_t);

let _udp_flowinfo = StructType();
_udp_flowinfo.defineProperty("remote_addr", ref.types.CString);
_udp_flowinfo.defineProperty("remote_port", ref.types.int);
_udp_flowinfo.defineProperty("socket_id", ref.types.int);
const lokinet_udp_flowinfo_t = _udp_flowinfo;
const lokinet_udp_flowinfo_ptr = ref.refType(lokinet_udp_flowinfo_t);

let _udp_bind_result = StructType();
_udp_bind_result.defineProperty("socket_id", ref.types.int);
const lokinet_udp_bind_result_t = _udp_bind_result;
const lokinet_udp_bind_result_ptr = ref.refType(lokinet_udp_bind_result_t);

const lokinet_udp_flow_filter = ffi.Function("int", ["void*", lokinet_udp_flowinfo_ptr, "void**", "int*"], null);
const lokinet_udp_flow_recv_func = ffi.Function("void", [lokinet_udp_flowinfo_ptr, "string", "size_t", "void*"], null);
const lokinet_udp_flow_timeout_func = ffi.Function("void", [lokinet_udp_flowinfo_ptr, "void*"], null);

const _lokinet = ffi.Library(_get_libname(), {
  /* lokinet_context.h */
  'lokinet_context_new': [lokinet_ctx, []],
  'lokinet_context_free': [ 'void', [lokinet_ctx]],
  'lokinet_context_start': [ 'int', [lokinet_ctx]],
  'lokinet_status': [ 'int', [lokinet_ctx]],
  'lokinet_wait_for_ready': ['int', ['int', lokinet_ctx]],
  'lokinet_context_step': ['void', [lokinet_ctx]],
  'lokinet_add_bootstrap_rc': ['int', ['string', 'size_t', lokinet_ctx]],
  /* lokinet_stream.h */
  'lokinet_outbound_stream': ['void', [lokinet_stream_result_ptr, 'string', 'string', lokinet_ctx]],
  'lokinet_inboud_stream': ['int', ['uint16_t', lokinet_ctx]],
  /* lokinet_socket.h */
  'lokinet_close_socket': ['void', ['int', lokinet_ctx]],
  /* lokinet_udp.h */
  'lokinet_udp_bind': ['int', ['int', lokinet_udp_flow_filter, lokinet_udp_flow_recv_func, lokinet_udp_flow_timeout_func, 'void*', lokinet_udp_listen_result_ptr, lokinet_ctx]],
  'lokinet_udp_establish': ['int', [lokinet_udp_flowinfo_ptr, lokinet_ctx]],
  'lokinet_udp_flow_send': ['int', [lokinet_udp_flowinfo_ptr, 'void*', 'size_t', lokinet_ctx]]
});
