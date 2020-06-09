# 说明
这个是snowpack优化版本 不保证跟官方版本同步

# 安装
```
npm i --save git+https://github.com/fangkyi03/snowpack-node.git
```

# 修复功能
1.增加babel-plugin-import支持

2.增加对@ant-design/icons支持

3.修改部分路径下的css热更新失效问题

4.将@ant-design/icons部分抽离成babel-plugin(将其配置到babel.config.json)

5.修复新增css样式无法热更新问题
