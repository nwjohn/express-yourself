let bcrypt = require('bcrypt-nodejs');
let uuid = require('uuid/v1');
let Promise = require('bluebird');

let RestfulController = require('./_restful-controller');

module.exports = class UserController extends RestfulController {
  get prefix() { return '/user'; }

  get confirmEmail() { return false; }

  async list(req, res, db) {
    let start = parseInt(req.query.start) || 0;
    let length = parseInt(req.query.length) || 10;
    let sort = {
      column: req.query.sort || 'email',
      desc: req.query.desc === 'true' || false
    };

    if (req.headers && req.headers['accept'] && req.headers['accept'].toLowerCase().indexOf('application/json') >= 0) {
      let p = await db.paginate('users/forList', start, length, {
        start_key: [sort.column, !sort.desc ? null : {}],
        end_key: [sort.column, !sort.desc ? {} : null],
        descending: sort.desc
      });

      return res.json({
        list: p.list.map(user => {
          delete user.password;
          return user;
        }),
        pagination: p.pagination,
        sort: sort
      });
    }

    return res.render('user/list', {
      query: {
        start,
        length,
        sort: sort.column,
        desc: sort.desc
      }
    });
  }

  async show(req, res, db) {
    console.log(req.path);

    let user = await db.get(req.params.id);

    //Not quite Restful, but it needed to go in a GET method
    if (req.query.token) {
      if (req.query.token === user.confirmationToken) {
        delete user.confirmationToken;
        user.confirmed = true;

        await db.put(user);
        req.flash('info', 'Email Confirmed');

        return res.redirect('/');
      }
    }

    return res.render('user/show', { 
      thisUser: user
    });
  }

  add(req, res) {
    res.render('user/add');
  }

  async create(req, res, db, mailer, config, _) {
    let user = _.merge(req.body, {
      enabled: true,
      type: 'user'
    });

    let users = await db.query('users/byEmail', { 
      key: user.email,
      include_docs: true 
    })

    if (users.rows.length) {
      req.flash('error', 'Given email is already in use by another account')
    }else{
      user.password = bcrypt.hashSync(user.password);
      user._id = uuid();

      if (this.confirmEmail) {
        let url = req.get('host');
        if (url) {
          url = `${req.protocol}://${url}`;
        }else{
          url = config.hostname;
        }
        user.confirmationToken = uuid();
        let response = await mailer.sendTemplate(user.email, 'confirm-email', {
          user,
          confirmationLink: `${url}/user/${user._id}?token=${user.confirmationToken}`
        });
      }else{
        user.confirmed = true;
      }

      await db.put(user);
      
      req.flash('success', 'User created');
    }
    res.redirect('/user/add');
  }

  async action(req, res, db, _) {
    let ids = Array.isArray(req.body._id) || !req.body._id ? req.body._id : [ req.body._id ];
    
    if (ids && ids.length) {
      let result = await db.allDocs({
        keys: ids, 
        include_docs: true
      });

      let change = {};
      switch (req.body.action) {
        case "Delete":
          change._deleted = true;
          break;
        case "Enable":
          change.enabled = true;
          break;
        case "Disable":
          change.enabled = false;
          break;
      }

      let docs = result.rows.map(row => {
        row.doc = _.extend(row.doc, change);
        return row.doc;
      });
      
      req.flash('success', `Users ${req.body.action}d`);
      await db.bulkDocs(docs);
    }else{
      req.flash('error', 'No users selected');
    }
      
    res.redirect('/user/list');
  }
};
